/**
 * Worker process entrypoint (pnpm worker → dist/queue/index.js).
 *
 * Separado do servidor HTTP (src/index.ts) — processo independente.
 * Roda os 4 workers + 2 repeat jobs — timeout scan (B2) e approval
 * expiry (E+B3 / bevox-backend/ADR-019 — supersedes hub ADR-025).
 * O harness consome bevox.execution.dispatch BullMQ-nativamente
 * (ADR-019) — NÃO aqui.
 *
 * Logging: usa o logger Pino raiz `logger()` de @/shared/logger.js, que
 * é o canal canônico para "bootstrap, workers e CLI" (ver docstring do
 * módulo). Erros fatais vão para o root logger estruturado via logger(),
 * com captureException() para paridade de Sentry com src/index.ts.
 */

import { Queue, Worker, type Job } from "bullmq";

import { env } from "@/config/env.js";
import { closeDb } from "@/db/client.js";
import { BUFFER_CUTOFF_QUEUE, INGESTION_EVENT_QUEUE, closeQueues } from "@/lib/queues.js";
import { createBullMQConnection } from "@/lib/redis.js";
import {
  GOOGLE_INCREMENTAL_SAFETY_CRON,
  GOOGLE_INCREMENTAL_SAFETY_JOB_NAME,
  GOOGLE_INCREMENTAL_SYNC_QUEUE,
  GOOGLE_PUSH_JOB_NAME,
  GOOGLE_PUSH_QUEUE,
  GOOGLE_PUSH_REPEAT_CRON,
  GOOGLE_WATCH_RENEWAL_CRON,
  GOOGLE_WATCH_RENEWAL_JOB_NAME,
  GOOGLE_WATCH_RENEWAL_QUEUE,
} from "@/modules/calendar/google/constants.js";
import {
  handleGoogleIncremental,
  handleGoogleIncrementalSafety,
  handleGooglePush,
  handleGoogleWatchRenewal,
} from "@/modules/calendar/google/workers.js";
// nudge jobs use WAITLIST_MATCH_JOB_NAME → else (drain) branch
import {
  WAITLIST_MATCH_QUEUE,
  WAITLIST_MATCH_SWEEP_JOB_NAME,
} from "@/modules/calendar/waitlist/constants.js";
import { drainWaitlistMatch, runWaitlistSweep } from "@/modules/calendar/waitlist/service.js";
import { handleExpiryScan } from "@/modules/executions/expiry.js";
import {
  PACKAGE_EXPIRY_JOB_NAME,
  PACKAGE_EXPIRY_QUEUE,
  handlePackageExpirySweep,
} from "@/modules/payments/cron.js";
import { reconcileStuckIntents, reconcileStuckRefunds } from "@/modules/payments/reconcile.js";
import {
  EXPIRY_SCAN_JOB_NAME,
  EXPIRY_SCAN_REPEAT_CRON,
  TIMEOUT_SCAN_JOB_NAME,
  TIMEOUT_SCAN_REPEAT_CRON,
} from "@/modules/orchestration/constants.js";
import { handleCutoff, type CutoffJob } from "@/modules/orchestration/cutoff.js";
import { handleIngestionEvent, type IngestionEventJob } from "@/modules/orchestration/intake.js";
import { handleTimeoutScan } from "@/modules/orchestration/timeout.js";
import { logger } from "@/shared/logger.js";
import { captureException, shutdownTelemetry } from "@/shared/telemetry.js";

const TIMEOUT_QUEUE = "bevox.timeout.scan";
const EXPIRY_QUEUE = "bevox.approval.expiry";

// M5-P2a Item 5a — payment-intent reconcile cron (Risk-8 belt-and-suspenders:
// BullMQ repeatable garante single worker pickup, advisory_xact_lock dentro
// do handler defende contra horizontal scaling drift).
const PAYMENTS_RECONCILE_INTENT_QUEUE = "bevox.payments.reconcile.intent";
const PAYMENTS_RECONCILE_INTENT_JOB_NAME = "payments-reconcile-intent";

// M5-P2a Item 5b — refund.requested reconcile cron. Mirror do intent
// (Risk-8): BullMQ repeatable + advisory_xact_lock(0x4256, 0x0002) no
// handler defendem em duas camadas contra workers concorrentes.
const PAYMENTS_RECONCILE_REFUND_QUEUE = "bevox.payments.reconcile.refund";
const PAYMENTS_RECONCILE_REFUND_JOB_NAME = "payments-reconcile-refund";

async function main(): Promise<void> {
  env(); // valida env cedo (igual a src/index.ts)

  const log = logger();
  const cfg = env();

  // concurrency:1 default (BullMQ) — V1 throughput; raise per-worker when ingestion volume warrants.
  const workers: Worker[] = [
    new Worker(
      INGESTION_EVENT_QUEUE,
      async (job: Job) => handleIngestionEvent(job as Job<IngestionEventJob>),
      { connection: createBullMQConnection() },
    ),
    new Worker(BUFFER_CUTOFF_QUEUE, async (job: Job) => handleCutoff(job as Job<CutoffJob>), {
      connection: createBullMQConnection(),
    }),
    new Worker(TIMEOUT_QUEUE, async () => handleTimeoutScan(), {
      connection: createBullMQConnection(),
    }),
    new Worker(EXPIRY_QUEUE, async () => handleExpiryScan(), {
      connection: createBullMQConnection(),
    }),
    // C2 Google — push-drain (cron drena outbox), incremental (job por
    // conexão, gatilho webhook OU cron de safety), watch-renewal (cron).
    new Worker(GOOGLE_PUSH_QUEUE, async () => handleGooglePush(), {
      connection: createBullMQConnection(),
    }),
    new Worker(
      GOOGLE_INCREMENTAL_SYNC_QUEUE,
      async (job: Job) => {
        // Job de webhook → { connectionId }. Job de safety-cron (sem
        // payload) → varre TODAS as conexões ativas (#1 + #5).
        const data = (job.data ?? {}) as { connectionId?: string };
        if (data.connectionId) {
          await handleGoogleIncremental(job as Job<{ connectionId: string }>);
        } else {
          await handleGoogleIncrementalSafety();
        }
      },
      { connection: createBullMQConnection() },
    ),
    new Worker(GOOGLE_WATCH_RENEWAL_QUEUE, async () => handleGoogleWatchRenewal(), {
      connection: createBullMQConnection(),
    }),
    // C3 Waitlist — sweep (repeatable, safety) + nudge/drain. Nudge jobs
    // carregam WAITLIST_MATCH_JOB_NAME e caem no else (drain).
    new Worker(
      WAITLIST_MATCH_QUEUE,
      async (job: Job) => {
        if (job.name === WAITLIST_MATCH_SWEEP_JOB_NAME) {
          await runWaitlistSweep(cfg.WAITLIST_MATCH_DEAD_LETTER_MAX);
        } else {
          await drainWaitlistMatch(cfg.WAITLIST_MATCH_DEAD_LETTER_MAX);
        }
      },
      { connection: createBullMQConnection() },
    ),
    // P4 Payments — package expiry sweep (noturno).
    new Worker(PACKAGE_EXPIRY_QUEUE, async () => handlePackageExpirySweep(), {
      connection: createBullMQConnection(),
    }),
    // M5-P2a Item 5a — payment-intent reconcile cron. Handler aplica
    // pg_try_advisory_xact_lock(0x4256, 0x0001) TX-scope dentro do
    // getDb().transaction (defesa contra horizontal scaling).
    new Worker(PAYMENTS_RECONCILE_INTENT_QUEUE, async () => reconcileStuckIntents(), {
      connection: createBullMQConnection(),
    }),
    // M5-P2a Item 5b — refund.requested reconcile cron. Mirror do intent;
    // pg_try_advisory_xact_lock(0x4256, 0x0002) — workerId distinto permite
    // intent + refund crons rodarem concorrentes (locks independentes).
    new Worker(PAYMENTS_RECONCILE_REFUND_QUEUE, async () => reconcileStuckRefunds(), {
      connection: createBullMQConnection(),
    }),
  ];

  const timeoutQueue = new Queue(TIMEOUT_QUEUE, {
    connection: createBullMQConnection(),
  });
  // Idempotent across restarts: BullMQ keys the repeatable by
  // (name, pattern), not jobId — re-adding upserts the single scheduler.
  await timeoutQueue.add(
    TIMEOUT_SCAN_JOB_NAME,
    {},
    {
      repeat: { pattern: TIMEOUT_SCAN_REPEAT_CRON },
    },
  );

  const expiryQueue = new Queue(EXPIRY_QUEUE, {
    connection: createBullMQConnection(),
  });
  // Idempotent across restarts: BullMQ keys the repeatable by
  // (name, pattern), not jobId — re-adding upserts the single scheduler.
  await expiryQueue.add(
    EXPIRY_SCAN_JOB_NAME,
    {},
    {
      repeat: { pattern: EXPIRY_SCAN_REPEAT_CRON },
    },
  );

  // C2 Google — repeatables. Idempotente across restarts: BullMQ keia o
  // repeatable por (name, pattern). O incremental-safety enfileira SEM
  // connectionId → o worker varre todas as conexões (sweep).
  const googlePushQueue = new Queue(GOOGLE_PUSH_QUEUE, {
    connection: createBullMQConnection(),
  });
  await googlePushQueue.add(
    GOOGLE_PUSH_JOB_NAME,
    {},
    {
      repeat: { pattern: GOOGLE_PUSH_REPEAT_CRON },
    },
  );

  const googleWatchRenewalQueue = new Queue(GOOGLE_WATCH_RENEWAL_QUEUE, {
    connection: createBullMQConnection(),
  });
  await googleWatchRenewalQueue.add(
    GOOGLE_WATCH_RENEWAL_JOB_NAME,
    {},
    {
      repeat: { pattern: GOOGLE_WATCH_RENEWAL_CRON },
    },
  );

  const googleIncrementalQueue = new Queue(GOOGLE_INCREMENTAL_SYNC_QUEUE, {
    connection: createBullMQConnection(),
  });
  await googleIncrementalQueue.add(
    GOOGLE_INCREMENTAL_SAFETY_JOB_NAME,
    {},
    {
      repeat: { pattern: GOOGLE_INCREMENTAL_SAFETY_CRON },
    },
  );

  const waitlistMatchQueue = new Queue(WAITLIST_MATCH_QUEUE, {
    connection: createBullMQConnection(),
  });
  // Idempotente across restarts: BullMQ keia o repeatable por (name, pattern).
  await waitlistMatchQueue.add(
    WAITLIST_MATCH_SWEEP_JOB_NAME,
    {},
    {
      repeat: { pattern: cfg.WAITLIST_MATCH_CRON },
    },
  );

  // P4 Payments — repeatable cron de expiry de CustomerPackage.
  const packageExpiryQueue = new Queue(PACKAGE_EXPIRY_QUEUE, {
    connection: createBullMQConnection(),
  });
  await packageExpiryQueue.add(
    PACKAGE_EXPIRY_JOB_NAME,
    {},
    {
      repeat: { pattern: cfg.PACKAGE_EXPIRY_CRON },
    },
  );

  // M5-P2a Item 5a — repeatable payment-intent reconcile cron.
  // Idempotente across restarts: BullMQ keia o repeatable por (name, pattern).
  const paymentsReconcileIntentQueue = new Queue(PAYMENTS_RECONCILE_INTENT_QUEUE, {
    connection: createBullMQConnection(),
  });
  await paymentsReconcileIntentQueue.add(
    PAYMENTS_RECONCILE_INTENT_JOB_NAME,
    {},
    {
      repeat: { pattern: cfg.PAYMENTS_RECONCILE_INTENT_CRON },
    },
  );

  // M5-P2a Item 5b — repeatable refund.requested reconcile cron.
  // Idempotente across restarts: BullMQ keia o repeatable por (name, pattern).
  const paymentsReconcileRefundQueue = new Queue(PAYMENTS_RECONCILE_REFUND_QUEUE, {
    connection: createBullMQConnection(),
  });
  await paymentsReconcileRefundQueue.add(
    PAYMENTS_RECONCILE_REFUND_JOB_NAME,
    {},
    {
      repeat: { pattern: cfg.PAYMENTS_RECONCILE_REFUND_CRON },
    },
  );

  for (const w of workers) {
    w.on("failed", (job, err) => {
      log.error({ worker: w.name, jobId: job?.id, err }, "worker job failed");
    });
    w.on("error", (err) => {
      log.error({ worker: w.name, err }, "worker connection error");
      captureException(err, { kind: "worker_error", worker: w.name });
    });
  }
  log.info("B2 orchestration workers started");

  let shuttingDown = false;
  const shutdown = async (): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    setTimeout(() => {
      log.error("worker shutdown timeout — force exit");
      process.exit(1);
    }, 25_000).unref();
    await Promise.all(workers.map((w) => w.close()));
    await timeoutQueue.close();
    await expiryQueue.close();
    await googlePushQueue.close();
    await googleWatchRenewalQueue.close();
    await googleIncrementalQueue.close();
    await waitlistMatchQueue.close();
    await packageExpiryQueue.close();
    await paymentsReconcileIntentQueue.close();
    await paymentsReconcileRefundQueue.close();
    await closeQueues();
    try {
      await closeDb();
    } catch (e) {
      log.error({ err: e }, "closeDb failed during shutdown");
    }
    try {
      await shutdownTelemetry();
    } catch (e) {
      log.error({ err: e }, "shutdownTelemetry failed during shutdown");
    }
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown());
  process.on("SIGINT", () => void shutdown());
}

main().catch((err: unknown) => {
  captureException(err, { kind: "worker_bootstrap" });
  logger().error({ err }, "worker fatal");
  process.exit(1);
});
