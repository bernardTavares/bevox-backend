/**
 * C2 Google — handlers de worker (4): push-drain, incremental (por job),
 * incremental-safety (cron sweep) e watch-renewal (cron sweep).
 *
 * Invariantes de hardening (revisões T3/T6/T7):
 *  - #1 single-flight por conexão: incremental SEMPRE sob `withConnectionLock`
 *    (webhook job + safety cron disputam a MESMA conexão → sem o lock criam
 *    appointments `external_sync` duplicados + estouram unique-violation).
 *  - #3 dead-letter ceiling: outbox row com attempts ≥4 → `error` (não
 *    requeue infinito).
 *  - #5 isolamento de erro: nos sweeps (safety/renewal) cada conexão tem seu
 *    try/catch — uma conexão ruim NÃO aborta o sweep inteiro.
 *  - PII: NUNCA logar `err.message`/`.body` cru — `GoogleApiError.body` pode
 *    ecoar `summary` (PII do cliente). Só `{ id, attempts, name?, status? }`.
 */
import type { Job } from "bullmq";

import { logger } from "@/shared/logger.js";

import { GoogleApiError } from "./client.js";
import { withConnectionLock } from "./lock.js";
import * as repo from "./repository.js";
import { processOutboxIntent, renewWatch, runIncrementalSync } from "./sync.js";

const OUTBOX_BATCH = 50;
const OUTBOX_MAX_ATTEMPTS = 4;

/**
 * Resumo PII-safe de um erro p/ log estruturado. NUNCA inclui
 * `.message`/`.body` cru (GoogleApiError.body pode ecoar summary do cliente).
 */
function safeErrSummary(err: unknown): Record<string, unknown> {
  if (err instanceof GoogleApiError) {
    return { err_name: err.name, err_status: err.status };
  }
  if (err instanceof Error) return { err_name: err.name };
  return { err_name: "unknown" };
}

/**
 * #3 — drena um batch do outbox. Por linha: processa → finishOutbox; em
 * erro, dead-letter ceiling: attempts ≥4 → `error` (para), senão requeue.
 * NÃO loga corpo do erro (PII).
 */
export async function handleGooglePush(): Promise<void> {
  const rows = await repo.claimOutboxBatch(OUTBOX_BATCH);
  for (const row of rows) {
    try {
      const result = await processOutboxIntent(row);
      await repo.finishOutbox(row.id, result === "done" ? "done" : "skipped");
    } catch (err) {
      const summary = safeErrSummary(err);
      if (row.attempts >= OUTBOX_MAX_ATTEMPTS) {
        await repo.finishOutbox(row.id, "error", "max attempts exceeded");
        logger().warn(
          { outboxId: row.id, attempts: row.attempts, ...summary },
          "google push intent dead-lettered",
        );
      } else {
        await repo.requeueOutbox(row.id, "transient failure");
        logger().warn(
          { outboxId: row.id, attempts: row.attempts, ...summary },
          "google push intent failed; requeued",
        );
      }
    }
  }
}

/**
 * #1 — incremental de UMA conexão (job de webhook). Sob `withConnectionLock`
 * (skip se outro run cobre). Erro propaga ao BullMQ (retry/backoff por job).
 */
export async function handleGoogleIncremental(job: Job<{ connectionId: string }>): Promise<void> {
  const connectionId = job.data.connectionId;
  if (!connectionId) return;
  await withConnectionLock(connectionId, () => runIncrementalSync(connectionId));
}

/**
 * #1 + #5 — cron safety sweep: incremental p/ TODAS as conexões ativas.
 * Cada conexão: try/catch isolado + single-flight lock. Conexão ruim NÃO
 * aborta o sweep; lock garante que o sweep não duplica o job de webhook.
 */
export async function handleGoogleIncrementalSafety(): Promise<void> {
  const conns = await repo.listActiveConnections();
  for (const conn of conns) {
    try {
      await withConnectionLock(conn.id, () => runIncrementalSync(conn.id));
    } catch (err) {
      logger().warn(
        { connId: conn.id, ...safeErrSummary(err) },
        "google incremental safety sweep: connection failed",
      );
    }
  }
}

/**
 * #1 + #5 — cron renewal: renova watch das conexões próximas do vencimento.
 * Cada conexão: try/catch isolado + connection-lock (serializa vs incremental
 * e fecha a janela de refresh-token concorrente do renew).
 */
export async function handleGoogleWatchRenewal(): Promise<void> {
  const conns = await repo.connectionsNeedingWatchRenewal();
  for (const conn of conns) {
    try {
      await withConnectionLock(conn.id, () => renewWatch(conn.id));
    } catch (err) {
      logger().warn(
        { connId: conn.id, ...safeErrSummary(err) },
        "google watch renewal: connection failed",
      );
    }
  }
}
