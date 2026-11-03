/**
 * Repository for the 4 harness → backend callbacks (PRD §10.4).
 *
 * Runtime parameterized SQL via getDb() (no static @db import — flat-dist
 * alias gate, R3). All access is execution-scoped (the execution-token
 * plugin already resolved execution_id from the token hash).
 */

import { sql } from "drizzle-orm";

import { getDb } from "@/db/client.js";
import { uuidv7 } from "@/shared/uuid.js";

export interface ExecutionRow {
  id: string;
  organization_id: string;
  execution_mode: "manual_assisted" | "copilot" | "autonomous_supervised";
  status: string;
}

export async function findExecution(id: string): Promise<ExecutionRow | null> {
  const res = await getDb().execute(
    sql`SELECT id, organization_id, execution_mode, status
          FROM executions WHERE id = ${id} LIMIT 1`,
  );
  return (res.rows[0] as ExecutionRow | undefined) ?? null;
}

/** Token-hash → execution_id (execution-token plugin DB seam). */
export async function findExecutionIdByTokenHash(tokenHash: string): Promise<string | null> {
  const res = await getDb().execute(
    sql`SELECT id FROM executions
         WHERE execution_token_hash = ${tokenHash}
           AND status NOT IN ('done','error','cancelled','dead_letter')
         LIMIT 1`,
  );
  const row = res.rows[0] as { id: string } | undefined;
  return row?.id ?? null;
}

/**
 * Status-agnostic token→execution_id lookup. Used ONLY by the dead_letter
 * signal (PATCH /status='dead_letter', dispatch-contract amendment 2026-06-03):
 * the authoritative dead_letter transition (ADR-019 Amendment 1) must resolve
 * terminal executions that `findExecutionIdByTokenHash` excludes.
 */
export async function findExecutionIdByTokenHashAnyStatus(
  tokenHash: string,
): Promise<string | null> {
  const res = await getDb().execute(
    sql`SELECT id FROM executions WHERE execution_token_hash = ${tokenHash} LIMIT 1`,
  );
  const row = res.rows[0] as { id: string } | undefined;
  return row?.id ?? null;
}

/** PATCH /status — map harness status to internal execution status. */
export async function applyStatusTransition(
  id: string,
  status: "running" | "paused" | "cancelled",
): Promise<boolean> {
  const internal =
    status === "running" ? "processing" : status === "paused" ? "waiting_input" : "cancelled";
  const res = await getDb().execute(
    sql`UPDATE executions SET status = ${internal}, updated_at = now()
         WHERE id = ${id} RETURNING id`,
  );
  return res.rows.length > 0;
}

export type DeadLetterOutcome =
  | "transitioned"
  | "noop_idempotent"
  | "noop_done_anomaly"
  | "not_found";

/**
 * PATCH /status='dead_letter' — authoritative, idempotent terminal transition
 * (ADR-019 Amendment 1, aceito 2026-06-03). Wins over `error` and any non-`done`
 * state; idempotent no-op over `dead_letter`/`cancelled`; NEVER overwrites a
 * successful `done` (records an anomaly AuditEvent instead). Emits
 * `action='retry_exhausted'` on a real transition. Order-independent vs a prior
 * `/complete('failed')`: the conclusion guard already 409s a late `/complete`
 * once the row is `dead_letter`.
 */
export async function markExecutionDeadLetter(id: string): Promise<DeadLetterOutcome> {
  const db = getDb();
  const upd = await db.execute(
    sql`UPDATE executions SET status = 'dead_letter', updated_at = now()
         WHERE id = ${id} AND status NOT IN ('done','cancelled','dead_letter')
         RETURNING id, organization_id`,
  );
  const updated = upd.rows[0] as { id: string; organization_id: string } | undefined;
  if (updated) {
    await insertExecutionAudit({
      organizationId: updated.organization_id,
      executionId: id,
      action: "retry_exhausted",
      afterJson: { status: "dead_letter" },
    });
    return "transitioned";
  }
  // 0 rows updated: classify the no-op. The excluded set is done/cancelled/
  // dead_letter (+ a missing row).
  const cur = await db.execute(
    sql`SELECT organization_id, status FROM executions WHERE id = ${id} LIMIT 1`,
  );
  const row = cur.rows[0] as { organization_id: string; status: string } | undefined;
  if (!row) return "not_found";
  if (row.status === "dead_letter" || row.status === "cancelled") return "noop_idempotent";
  // Only `done` remains: never regress a successful execution. Record the
  // anomaly for forensics (signals a producer ordering/duplication bug).
  await insertExecutionAudit({
    organizationId: row.organization_id,
    executionId: id,
    action: "dead_letter_ignored_done_anomaly",
    afterJson: { kept_status: row.status, ignored_signal: "dead_letter" },
  });
  return "noop_done_anomaly";
}

/**
 * ADR-011 concurrency guard: atomically move to `completing` only from a
 * live state. Returns the row when it won the transition, else null (→409).
 */
export async function lockForCompletion(id: string): Promise<ExecutionRow | null> {
  const res = await getDb().execute(
    sql`UPDATE executions SET status = 'completing', updated_at = now()
         WHERE id = ${id}
           AND status IN ('processing','dispatching','waiting_input')
         RETURNING id, organization_id, execution_mode, status`,
  );
  return (res.rows[0] as ExecutionRow | undefined) ?? null;
}

export async function finalizeCompletion(
  id: string,
  finalStatus: "done" | "waiting_approval" | "error",
  resultPayload: unknown,
): Promise<void> {
  await getDb().execute(
    sql`UPDATE executions
           SET status = ${finalStatus},
               result_payload = ${JSON.stringify(resultPayload)}::jsonb,
               completed_at = now(),
               updated_at = now()
         WHERE id = ${id}`,
  );
}

export async function insertExecutionAudit(input: {
  organizationId: string;
  executionId: string;
  action: string;
  afterJson: Record<string, unknown>;
}): Promise<void> {
  await getDb().execute(
    sql`INSERT INTO audit_events
          (organization_id, entity_type, entity_id, action,
           actor_type, actor_id, execution_id, after_json)
        VALUES (${input.organizationId}, 'execution', ${input.executionId},
                ${input.action}, 'ai', NULL, ${input.executionId},
                ${JSON.stringify(input.afterJson)}::jsonb)`,
  );
}

/**
 * /traces — persiste entradas em execution_traces (PRD §10.4).
 *
 * Adaptado ao schema real (db/schema/execution_traces.ts): a tabela exige
 * (a) `id` UUIDv7 explícito — o pattern do codebase para INSERT via
 * `getDb().execute(sql\`…\`)` gera o id app-side com `uuidv7()` (o
 * `$defaultFn` do Drizzle NÃO dispara em SQL cru; mesmo pattern de
 * `handoffConversationOnTimeout`/`insertExecutionAudit`); e (b)
 * `organization_id` NOT NULL FK — recebido do route (exec.organization_id).
 *
 * Os inserts são um loop sequencial SEM transação (no batch-insert/tx helper
 * exists in the codebase — same accepted house pattern as
 * handoffConversationOnTimeout). Partial-failure window: numa falha no meio
 * do loop a rota responde 500 e o harness pode reenviar o batch inteiro →
 * linhas de trace duplicadas (ids uuidv7 distintos; sem idempotency key).
 * Aceitável porque `execution_traces` é dado de observability/debug — não
 * correctness/money-bearing. O `JSON.stringify(... ?? null)` grava um JSON
 * `'null'::jsonb` (NÃO SQL NULL) quando input/output ausente; a segurança da
 * serialização depende do body ser JSON-origin (do callback já validado).
 */
export async function insertExecutionTraces(
  executionId: string,
  organizationId: string,
  entries: Array<Record<string, unknown>>,
): Promise<number> {
  if (entries.length === 0) return 0;
  const db = getDb();
  for (const e of entries) {
    await db.execute(
      sql`INSERT INTO execution_traces
            (id, execution_id, organization_id, step_type, step_name,
             input_json, output_json, duration_ms)
          VALUES (${uuidv7()}, ${executionId}, ${organizationId},
                  ${String(e["step_type"] ?? e["type"] ?? "unknown")},
                  ${String(e["step_name"] ?? e["name"] ?? "unknown")},
                  ${JSON.stringify(e["input_json"] ?? e["input"] ?? null)}::jsonb,
                  ${JSON.stringify(e["output_json"] ?? e["output"] ?? null)}::jsonb,
                  ${Number.isFinite(Number(e["duration_ms"])) ? Number(e["duration_ms"]) : 0})`,
    );
  }
  return entries.length;
}

/** conversation_id + channel_connection_id da execução (para os seams). */
export async function findExecutionContext(
  id: string,
): Promise<{ conversation_id: string; channel_connection_id: string | null } | null> {
  const res = await getDb().execute(
    sql`SELECT e.conversation_id,
               (SELECT c.channel_connection_id FROM conversations c
                 WHERE c.id = e.conversation_id) AS channel_connection_id
          FROM executions e WHERE e.id = ${id} LIMIT 1`,
  );
  return (
    (res.rows[0] as
      | { conversation_id: string; channel_connection_id: string | null }
      | undefined) ?? null
  );
}

/**
 * request-human: escala a conversa own-domain (precedente B2 timeout).
 *
 * Performs TWO sequential writes with NO transaction (no tx helper exists in
 * the codebase — same pattern as handoffConversationOnTimeout): (1)
 * conversations → waiting_human/queue, (2) audit_events insert. Invoked from
 * resolveComplete BEFORE the route's finalizeCompletion, so the same non-tx
 * partial-failure window applies: if a later step (finalizeCompletion) fails,
 * the conversation may be escalated while the execution stays in 'completing'
 * — bounded by the Marco-1 lock; no external side effect since the seams are
 * no-ops. Follow-on: wrap the 2 writes in a transaction once a shared tx
 * helper exists (tracked, parity with handoffConversationOnTimeout's note).
 */
export async function escalateConversationRequestHuman(input: {
  organizationId: string;
  conversationId: string;
  executionId: string;
}): Promise<void> {
  const db = getDb();
  await db.execute(
    sql`UPDATE conversations
          SET status = 'waiting_human', current_owner_type = 'queue',
              current_owner_id = NULL, updated_at = now()
        WHERE id = ${input.conversationId}`,
  );
  await db.execute(
    sql`INSERT INTO audit_events
          (organization_id, entity_type, entity_id, action,
           actor_type, actor_id, execution_id, after_json)
        VALUES (${input.organizationId}, 'conversation', ${input.conversationId},
                'conversation.handoff_request_human', 'ai', NULL, ${input.executionId},
                ${JSON.stringify({ reason: "strategy_request_human" })}::jsonb)`,
  );
}
