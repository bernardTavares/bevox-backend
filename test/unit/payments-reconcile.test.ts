/**
 * M5-P2a Item 5a: payment-intent reconcile cron.
 *
 * reconcileStuckIntents() acquires pg_try_advisory_xact_lock(0x4256, 0x0001)
 * inside getDb().transaction (TX-scope auto-release on COMMIT/ROLLBACK —
 * eliminates session-scope lock leak risk). Queries stuck charges WHERE
 * status='pending' AND created_at < now() - 24h ORDER BY created_at
 * ASC LIMIT 50; for each, fetches authoritative PI status from Stripe and
 * reconciles local row. Status query usa enum LOCAL bevox
 * (`charges.status='pending'`); Stripe status mapeado para enum local
 * canon (`'succeeded'→'paid'`, `'canceled'→'cancelled'`). NOTA: spec
 * inicial usava terminologia Stripe-internal (`'requires_action'`,
 * `'completed'`) — corrigido em T6 review para usar enum local bevox
 * (CHECK constraint canon).
 *
 * Spec: docs/superpowers/specs/2026-05-21-backend-m5-p2-tech-debt-design.md §4.2
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const dbRows: Array<{ id: string; provider_charge_id: string | null }> = [];
const refundRows: Array<{ id: string; provider_refund_id: string | null }> = [];
const txCalls: string[] = [];
const lockOutcomes: Array<{ acquired: boolean }> = [];

/**
 * Drizzle `sql` template tag yields an `SQL` instance whose printable shape
 * is exposed via `queryChunks`. We stringify the static chunks to recover
 * the SQL text for inspection (parameters are placeholders — irrelevant
 * for shape assertions).
 */
function sqlChunksToText(q: unknown): string {
  const obj = q as { queryChunks?: Array<unknown> } | null;
  if (!obj || !Array.isArray(obj.queryChunks)) return String(q);
  return obj.queryChunks
    .map((c) => {
      const chunk = c as { value?: ReadonlyArray<string> } | string | undefined;
      if (typeof chunk === "string") return chunk;
      if (chunk && Array.isArray(chunk.value)) return chunk.value.join("");
      return ""; // parameters (StringChunk/Param) — placeholder
    })
    .join(" ");
}

const txExec = vi.fn(async (q: unknown) => {
  const stmt = sqlChunksToText(q);
  txCalls.push(stmt);
  // First call inside reconcileStuckIntents is the advisory_xact_lock probe
  if (/pg_try_advisory_xact_lock/i.test(stmt)) {
    return { rows: [lockOutcomes.shift() ?? { acquired: true }] };
  }
  // Second call is the stuck rows SELECT
  if (/FROM\s+charges/i.test(stmt) && /SELECT/i.test(stmt)) {
    return { rows: dbRows };
  }
  if (/FROM\s+refunds/i.test(stmt) && /SELECT/i.test(stmt)) {
    return { rows: refundRows };
  }
  // Subsequent updates
  return { rows: [] };
});
const dbExec = vi.fn(async () => ({ rows: [] }));
const mockDb = {
  execute: dbExec,
  transaction: vi.fn(async (cb: (tx: { execute: typeof txExec }) => Promise<unknown>) =>
    cb({ execute: txExec }),
  ),
};

vi.mock("@/db/client.js", () => ({ getDb: () => mockDb }));
vi.mock("@/shared/logger.js", () => ({
  logger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

const mockStripe = {
  paymentIntents: {
    retrieve: vi.fn(async (id: string) => ({ id, status: "succeeded" })),
  },
  refunds: {
    retrieve: vi.fn(async (id: string) => ({ id, status: "succeeded" })),
  },
};
vi.mock("@/modules/payments/stripe-client.js", () => ({ getStripe: () => mockStripe }));

const {
  reconcileStuckIntents,
  reconcileStuckRefunds,
  RECONCILE_INTENT_ADVISORY_LOCK_KEY,
  RECONCILE_REFUND_ADVISORY_LOCK_KEY,
  RECONCILE_STUCK_LIMIT,
} = await import("@/modules/payments/reconcile.js");

beforeEach(() => {
  dbRows.length = 0;
  refundRows.length = 0;
  txCalls.length = 0;
  lockOutcomes.length = 0;
  txExec.mockClear();
  dbExec.mockClear();
  mockDb.transaction.mockClear();
  mockStripe.paymentIntents.retrieve.mockClear();
  mockStripe.refunds.retrieve.mockClear();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("reconcileStuckIntents — advisory lock + drain", () => {
  it("uses canonical bevox-backend payments namespace 0x4256 + worker 0x0001", () => {
    expect(RECONCILE_INTENT_ADVISORY_LOCK_KEY).toEqual({
      namespace: 0x4256,
      workerId: 0x0001,
    });
  });

  it("acquires pg_try_advisory_xact_lock and early-exits if not acquired", async () => {
    lockOutcomes.push({ acquired: false });
    dbRows.push({ id: "ch-1", provider_charge_id: "pi_stripe_1" });

    await reconcileStuckIntents();

    expect(mockDb.transaction).toHaveBeenCalledOnce();
    // Only the lock probe ran; no SELECT/UPDATE/Stripe retrieve
    expect(txCalls.length).toBe(1);
    expect(txCalls[0]).toMatch(/pg_try_advisory_xact_lock/i);
    expect(mockStripe.paymentIntents.retrieve).not.toHaveBeenCalled();
  });

  it("queries stuck PIs with ORDER BY created_at ASC + LIMIT 50 (FIFO drain)", async () => {
    dbRows.push({ id: "ch-1", provider_charge_id: "pi_stripe_1" });

    await reconcileStuckIntents();

    // Find the SELECT stmt
    const selectStmt = txCalls.find((s) => /FROM\s+charges/i.test(s) && /SELECT/i.test(s));
    expect(selectStmt).toBeDefined();
    expect(selectStmt!).toMatch(/ORDER BY/i);
    expect(selectStmt!).toMatch(/created_at/i);
    expect(selectStmt!).toMatch(/ASC/i);
    expect(selectStmt!).toMatch(/LIMIT/i);
    // RECONCILE_STUCK_LIMIT is exported as 50 (FIFO drain cap)
    expect(RECONCILE_STUCK_LIMIT).toBe(50);
  });

  it("fetches each stuck PI from Stripe by provider_charge_id and updates local row", async () => {
    dbRows.push({ id: "ch-1", provider_charge_id: "pi_stripe_1" });
    dbRows.push({ id: "ch-2", provider_charge_id: "pi_stripe_2" });

    await reconcileStuckIntents();

    expect(mockStripe.paymentIntents.retrieve).toHaveBeenCalledTimes(2);
    expect(mockStripe.paymentIntents.retrieve).toHaveBeenCalledWith("pi_stripe_1");
    expect(mockStripe.paymentIntents.retrieve).toHaveBeenCalledWith("pi_stripe_2");

    // Each row triggered an UPDATE inside tx
    const updateStmts = txCalls.filter((s) => /UPDATE\s+charges/i.test(s));
    expect(updateStmts.length).toBe(2);
  });

  it("skips rows with NULL provider_charge_id (defensive: nothing to reconcile)", async () => {
    dbRows.push({ id: "ch-null", provider_charge_id: null });

    await reconcileStuckIntents();

    expect(mockStripe.paymentIntents.retrieve).not.toHaveBeenCalled();
  });
});

describe("reconcileStuckRefunds — advisory lock + drain", () => {
  it("uses canonical bevox-backend payments namespace 0x4256 + worker 0x0002", () => {
    expect(RECONCILE_REFUND_ADVISORY_LOCK_KEY).toEqual({
      namespace: 0x4256,
      workerId: 0x0002,
    });
  });

  it("acquires pg_try_advisory_xact_lock with refund worker id (0x0002); early-exits if not acquired", async () => {
    lockOutcomes.push({ acquired: false });
    refundRows.push({ id: "rf-1", provider_refund_id: "re_stripe_1" });

    await reconcileStuckRefunds();

    expect(mockDb.transaction).toHaveBeenCalledOnce();
    // Only the lock probe ran; no SELECT/UPDATE/Stripe retrieve
    expect(txCalls.length).toBe(1);
    expect(txCalls[0]).toMatch(/pg_try_advisory_xact_lock/i);
    expect(mockStripe.refunds.retrieve).not.toHaveBeenCalled();
  });

  it("queries stuck refunds WHERE status='pending' AND created_at < now() - 1h ORDER BY ASC LIMIT 50", async () => {
    refundRows.push({ id: "rf-1", provider_refund_id: "re_stripe_1" });

    await reconcileStuckRefunds();

    const selectStmt = txCalls.find((s) => /FROM\s+refunds/i.test(s) && /SELECT/i.test(s));
    expect(selectStmt).toBeDefined();
    expect(selectStmt!).toMatch(/'pending'/i);
    expect(selectStmt!).toMatch(/1 hour/i);
    expect(selectStmt!).toMatch(/ORDER BY/i);
    expect(selectStmt!).toMatch(/created_at/i);
    expect(selectStmt!).toMatch(/ASC/i);
    expect(selectStmt!).toMatch(/LIMIT/i);
    expect(RECONCILE_STUCK_LIMIT).toBe(50);
  });

  it("fetches each stuck refund from Stripe by provider_refund_id and updates local row", async () => {
    refundRows.push({ id: "rf-1", provider_refund_id: "re_stripe_1" });
    refundRows.push({ id: "rf-2", provider_refund_id: "re_stripe_2" });

    await reconcileStuckRefunds();

    expect(mockStripe.refunds.retrieve).toHaveBeenCalledTimes(2);
    expect(mockStripe.refunds.retrieve).toHaveBeenCalledWith("re_stripe_1");
    expect(mockStripe.refunds.retrieve).toHaveBeenCalledWith("re_stripe_2");

    // Each row triggered an UPDATE inside tx
    const updateStmts = txCalls.filter((s) => /UPDATE\s+refunds/i.test(s));
    expect(updateStmts.length).toBe(2);
  });

  it("skips rows with NULL provider_refund_id (defensive: nothing to reconcile)", async () => {
    refundRows.push({ id: "rf-null", provider_refund_id: null });

    await reconcileStuckRefunds();

    expect(mockStripe.refunds.retrieve).not.toHaveBeenCalled();
  });
});
