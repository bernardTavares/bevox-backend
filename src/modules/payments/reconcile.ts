/**
 * Payment-intent + refund reconcile crons (M5-P2a Item 5).
 *
 * P2 follow-on do M3-P2: stuck PaymentIntent reconcile (T5).
 * P3 follow-on do M3-P3: stuck refund.requested reconcile (T6).
 *
 * Advisory lock garante single worker per cron run mesmo com horizontal
 * scaling (Risk-8 — concurrent workers race). Uso de
 * pg_try_advisory_xact_lock (TX-scope) — NÃO pg_try_advisory_lock
 * (session-scope) — para eliminar risco de lock leak se a connection
 * for devolvida ao pool sem unlock explícito (Agent #3-R3 HIGH fix).
 * Auto-release on COMMIT/ROLLBACK.
 *
 * Spec: docs/superpowers/specs/2026-05-21-backend-m5-p2-tech-debt-design.md §4.2
 */

import { sql } from "drizzle-orm";

import { getDb } from "@/db/client.js";
import { mapRefundStatus } from "@/modules/payments/charge-intent.js";
import { getStripe } from "@/modules/payments/stripe-client.js";
import { logger } from "@/shared/logger.js";
import {
  paymentsReconcileRunsTotal,
  paymentsReconcileSkippedConcurrentTotal,
  paymentsReconcileStuckCount,
} from "@/shared/metrics.js";

/**
 * Canonical advisory_xact_lock key for the payment-intent reconcile worker.
 *
 * - namespace 0x4256 ("BV") = bevox-backend payments — reservado para
 *   workers de pagamento neste serviço.
 * - workerId 0x0001 = payment-intent reconcile worker (this file).
 *
 * Outros workers em payments DEVEM usar namespace 0x4256 + workerId
 * distinto (refund reconcile = 0x0002 em T6).
 */
export const RECONCILE_INTENT_ADVISORY_LOCK_KEY = {
  namespace: 0x4256,
  workerId: 0x0001,
} as const;

/**
 * Canonical advisory_xact_lock key for the refund.requested reconcile worker.
 *
 * - namespace 0x4256 ("BV") = bevox-backend payments — mesmo namespace que
 *   intent (workers de pagamento neste serviço compartilham namespace).
 * - workerId 0x0002 = refund reconcile worker (distinto de intent 0x0001;
 *   refund cron pode rodar concorrente a intent cron — locks são independentes).
 */
export const RECONCILE_REFUND_ADVISORY_LOCK_KEY = {
  namespace: 0x4256,
  workerId: 0x0002,
} as const;

/** Cap per-tick para drain bounded; FIFO via ORDER BY created_at ASC. */
export const RECONCILE_STUCK_LIMIT = 50;

/**
 * Reconcile stuck PaymentIntents. Single-tick drain bounded por
 * RECONCILE_STUCK_LIMIT; cron repeatable picks up backlog em ticks
 * subsequentes.
 *
 * Comportamento:
 *  1. Abre transação.
 *  2. Tenta `pg_try_advisory_xact_lock(0x4256, 0x0001)`. Se outro worker
 *     já segura o lock, incrementa `skipped_concurrent_total` e retorna
 *     (early-exit). Lock auto-release on COMMIT.
 *  3. SELECT até 50 charges WHERE status='pending' AND created_at <
 *     now() - 24h ORDER BY created_at ASC. (Charges com Stripe PI vivos
 *     que ficaram travadas em 'pending' local — webhook perdido /
 *     Stripe outage / PI Stripe-side em estados não-progressivos como
 *     requires_action/requires_payment_method/processing.)
 *  4. Para cada row: `stripe.paymentIntents.retrieve(provider_charge_id)`
 *     + UPDATE charges.status com authoritative state do Stripe.
 *  5. Emite métricas: `paymentsReconcileStuckCount` (gauge),
 *     `paymentsReconcileRunsTotal{outcome=ok|fail}` (counter).
 */
export async function reconcileStuckIntents(): Promise<void> {
  const log = logger();
  await getDb().transaction(async (tx) => {
    const lockRes = await tx.execute(
      sql`SELECT pg_try_advisory_xact_lock(${RECONCILE_INTENT_ADVISORY_LOCK_KEY.namespace}, ${RECONCILE_INTENT_ADVISORY_LOCK_KEY.workerId}) AS acquired`,
    );
    const acquired = (lockRes.rows[0] as { acquired: boolean } | undefined)?.acquired === true;
    if (!acquired) {
      paymentsReconcileSkippedConcurrentTotal.inc({ worker: "intent" });
      log.info(
        { worker: "intent" },
        "reconcile.intent skipped: concurrent worker holds advisory lock",
      );
      return;
    }

    // Query stuck rows pelo enum LOCAL `charges.status` (CHECK constraint
    // `'pending'|'paid'|'expired'|'cancelled'|'refunded'`). Stuck =
    // status='pending' AND created_at < now() - 24h (pré-reconciliation
    // state — webhook perdido / Stripe outage / PI travado em
    // requires_action/requires_payment_method/processing no Stripe-side).
    const stuckRes = await tx.execute(sql`
      SELECT id, provider_charge_id
        FROM charges
       WHERE status = 'pending'
         AND created_at < now() - interval '24 hours'
       ORDER BY created_at ASC
       LIMIT ${RECONCILE_STUCK_LIMIT}
    `);

    const stuckRows = stuckRes.rows as Array<{
      id: string;
      provider_charge_id: string | null;
    }>;
    paymentsReconcileStuckCount.set({ worker: "intent" }, stuckRows.length);

    let okCount = 0;
    let failCount = 0;
    for (const row of stuckRows) {
      if (!row.provider_charge_id) {
        // Defensive: charge sem provider_charge_id não tem nada para
        // reconciliar contra Stripe. (Não deveria acontecer em pending
        // pós-PI-creation — gateway sempre seta provider_charge_id após
        // PI creation. Se acontecer, log + skip não-fatal.)
        log.warn(
          { chargeId: row.id, worker: "intent" },
          "reconcile.intent: skipping row with NULL provider_charge_id",
        );
        continue;
      }
      try {
        const pi = await getStripe().paymentIntents.retrieve(row.provider_charge_id);
        // Map Stripe PI status → local charges.status enum (CHECK
        // constraint canon). Estados Stripe que devem progredir local:
        //   'succeeded'  → 'paid'    (PI capturado).
        //   'canceled'   → 'cancelled' (PI cancelado).
        // Outros estados Stripe ('requires_action', 'requires_payment_method',
        // 'processing', 'requires_capture') NÃO progridem o local — charge
        // continua 'pending' até resolved. UPDATE somente se mudou.
        let localStatus: "pending" | "paid" | "expired" | "cancelled" | "refunded" | null = null;
        if (pi.status === "succeeded") localStatus = "paid";
        else if (pi.status === "canceled") localStatus = "cancelled";

        if (localStatus !== null) {
          await tx.execute(sql`
            UPDATE charges
               SET status = ${localStatus},
                   updated_at = now()
             WHERE id = ${row.id}
          `);
        }
        okCount++;
      } catch (err) {
        log.error(
          { err, chargeId: row.id, worker: "intent" },
          "reconcile.intent: stripe retrieve / DB update failed",
        );
        failCount++;
      }
    }

    if (okCount > 0) {
      paymentsReconcileRunsTotal.inc({ worker: "intent", outcome: "ok" }, okCount);
    }
    if (failCount > 0) {
      paymentsReconcileRunsTotal.inc({ worker: "intent", outcome: "fail" }, failCount);
    }
    log.info(
      { worker: "intent", stuck: stuckRows.length, ok: okCount, fail: failCount },
      "reconcile.intent done",
    );
  });
}

/**
 * Reconcile stuck refunds. Mirror de reconcileStuckIntents para refund
 * domain — single-tick drain bounded por RECONCILE_STUCK_LIMIT; cron
 * repeatable picks up backlog em ticks subsequentes.
 *
 * Comportamento:
 *  1. Abre transação.
 *  2. Tenta `pg_try_advisory_xact_lock(0x4256, 0x0002)`. Se outro worker
 *     já segura o lock, incrementa `skipped_concurrent_total{worker=refund}`
 *     e retorna (early-exit). Lock auto-release on COMMIT.
 *  3. SELECT até 50 refunds WHERE status='pending' AND created_at <
 *     now() - 1h ORDER BY created_at ASC. (Refunds travados em 'pending'
 *     local — webhook perdido / Stripe outage. Stale threshold 1h é
 *     mais agressivo que intent 24h porque refund queue é menor e
 *     expectativa de turnaround do operador é minutos. Local enum:
 *     `'pending'|'succeeded'|'failed'` per refunds_status_check.)
 *  4. Para cada row: `stripe.refunds.retrieve(provider_refund_id)` +
 *     UPDATE refunds.status com authoritative state do Stripe.
 *  5. Emite métricas: `paymentsReconcileStuckCount{worker=refund}` (gauge),
 *     `paymentsReconcileRunsTotal{worker=refund,outcome=ok|fail}` (counter).
 */
export async function reconcileStuckRefunds(): Promise<void> {
  const log = logger();
  await getDb().transaction(async (tx) => {
    const lockRes = await tx.execute(
      sql`SELECT pg_try_advisory_xact_lock(${RECONCILE_REFUND_ADVISORY_LOCK_KEY.namespace}, ${RECONCILE_REFUND_ADVISORY_LOCK_KEY.workerId}) AS acquired`,
    );
    const acquired = (lockRes.rows[0] as { acquired: boolean } | undefined)?.acquired === true;
    if (!acquired) {
      paymentsReconcileSkippedConcurrentTotal.inc({ worker: "refund" });
      log.info(
        { worker: "refund" },
        "reconcile.refund skipped: concurrent worker holds advisory lock",
      );
      return;
    }

    // Query stuck rows pelo enum LOCAL `refunds.status` (CHECK constraint
    // `'pending'|'succeeded'|'failed'`). Stuck = status='pending' AND
    // created_at < now() - 1h (pré-reconciliation state — webhook perdido
    // / Stripe outage). Threshold 1h é mais agressivo que intent 24h
    // porque refund queue é menor e turnaround esperado é minutos.
    const stuckRes = await tx.execute(sql`
      SELECT id, provider_refund_id
        FROM refunds
       WHERE status = 'pending'
         AND created_at < now() - interval '1 hour'
       ORDER BY created_at ASC
       LIMIT ${RECONCILE_STUCK_LIMIT}
    `);

    const stuckRows = stuckRes.rows as Array<{
      id: string;
      provider_refund_id: string | null;
    }>;
    paymentsReconcileStuckCount.set({ worker: "refund" }, stuckRows.length);

    let okCount = 0;
    let failCount = 0;
    for (const row of stuckRows) {
      if (!row.provider_refund_id) {
        // Defensive: refund sem provider_refund_id não tem nada para
        // reconciliar contra Stripe. (Não deveria acontecer em pending
        // pós-Refund-creation — gateway sempre seta provider_refund_id
        // após Refund creation. Se acontecer, log + skip não-fatal.)
        log.warn(
          { refundId: row.id, worker: "refund" },
          "reconcile.refund: skipping row with NULL provider_refund_id",
        );
        continue;
      }
      try {
        const rf = await getStripe().refunds.retrieve(row.provider_refund_id);
        // Map Stripe Refund status → local refunds.status via canonical
        // helper `mapRefundStatus` em charge-intent.ts:143 (CHECK
        // constraint `'pending'|'succeeded'|'failed'`). Helper já maps
        // Stripe 'succeeded' → 'succeeded', 'failed'/'canceled' → 'failed',
        // outros → 'pending'. UPDATE somente se mudou de 'pending'.
        const localStatus = mapRefundStatus(rf.status);
        if (localStatus !== "pending") {
          await tx.execute(sql`
            UPDATE refunds
               SET status = ${localStatus},
                   updated_at = now()
             WHERE id = ${row.id}
          `);
        }
        okCount++;
      } catch (err) {
        log.error(
          { err, refundId: row.id, worker: "refund" },
          "reconcile.refund: stripe retrieve / DB update failed",
        );
        failCount++;
      }
    }

    if (okCount > 0) {
      paymentsReconcileRunsTotal.inc({ worker: "refund", outcome: "ok" }, okCount);
    }
    if (failCount > 0) {
      paymentsReconcileRunsTotal.inc({ worker: "refund", outcome: "fail" }, failCount);
    }
    log.info(
      { worker: "refund", stuck: stuckRows.length, ok: okCount, fail: failCount },
      "reconcile.refund done",
    );
  });
}
