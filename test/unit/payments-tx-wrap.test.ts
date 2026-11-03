/**
 * M5-P2a Item 4: tx-wrap helper for payment status mutations.
 *
 * withPaymentTx(fn) opens a Drizzle transaction; updateOnboardingState +
 * insertPaymentAudit accept optional dbOrTx (default getDb()) so existing
 * callers without tx preserve current behavior.
 *
 * Spec: docs/superpowers/specs/2026-05-21-backend-m5-p2-tech-debt-design.md §4.1
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const txCalls: Array<{ stmt: string }> = [];
const mockTx = {
  execute: vi.fn(async (q: unknown) => {
    txCalls.push({ stmt: String(q) });
    return { rows: [] };
  }),
};
const mockDb = {
  transaction: vi.fn(async (cb: (tx: typeof mockTx) => Promise<unknown>) => cb(mockTx)),
  execute: vi.fn(async () => ({ rows: [] })),
};

vi.mock("@/db/client.js", () => ({ getDb: () => mockDb }));
vi.mock("@/shared/logger.js", () => ({
  logger: () => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn() }),
}));
vi.mock("@/lib/cache.js", () => ({
  cacheInvalidate: vi.fn(async () => undefined),
  cacheAside: vi.fn(),
}));

const { withPaymentTx, updateOnboardingState, insertPaymentAudit } =
  await import("@/modules/payments/repository.js");

beforeEach(() => {
  txCalls.length = 0;
  mockTx.execute.mockClear();
  mockDb.transaction.mockClear();
  mockDb.execute.mockClear();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("withPaymentTx (Item 4 — atomic UPDATE + audit INSERT)", () => {
  it("opens a transaction via getDb().transaction and threads tx into both calls", async () => {
    await withPaymentTx(async (tx) => {
      await updateOnboardingState(
        "org-1",
        "pa-1",
        {
          onboarding_status: "verified",
          charges_enabled: true,
          payouts_enabled: true,
          details_submitted: true,
        },
        tx,
      );
      await insertPaymentAudit(
        {
          organizationId: "org-1",
          paymentAccountId: "pa-1",
          action: "payment_account.status_changed",
          actorType: "system",
          afterJson: { onboarding_status: "verified" },
        },
        tx,
      );
    });

    expect(mockDb.transaction).toHaveBeenCalledOnce();
    // Both statements routed through the tx execute, not getDb().execute
    expect(mockTx.execute).toHaveBeenCalledTimes(2);
    expect(mockDb.execute).not.toHaveBeenCalled();
  });

  it("rolls back if callback throws (transaction rejects to caller)", async () => {
    await expect(
      withPaymentTx(async (tx) => {
        await updateOnboardingState(
          "org-1",
          "pa-1",
          {
            onboarding_status: "verified",
            charges_enabled: true,
            payouts_enabled: true,
            details_submitted: true,
          },
          tx,
        );
        throw new Error("intentional");
      }),
    ).rejects.toThrow("intentional");

    expect(mockDb.transaction).toHaveBeenCalledOnce();
    // UPDATE was issued inside tx (Drizzle/PG would roll it back on throw)
    expect(mockTx.execute).toHaveBeenCalledTimes(1);
  });
});

describe("updateOnboardingState + insertPaymentAudit default dbOrTx (preserve legacy callers)", () => {
  it("uses getDb() when dbOrTx omitted (non-tx callers unchanged)", async () => {
    await updateOnboardingState("org-2", "pa-2", {
      onboarding_status: "pending",
      charges_enabled: false,
      payouts_enabled: false,
      details_submitted: false,
    });
    await insertPaymentAudit({
      organizationId: "org-2",
      paymentAccountId: "pa-2",
      action: "payment_account.status_changed",
      actorType: "system",
      afterJson: { onboarding_status: "pending" },
    });

    expect(mockDb.transaction).not.toHaveBeenCalled();
    expect(mockDb.execute).toHaveBeenCalledTimes(2);
    expect(mockTx.execute).not.toHaveBeenCalled();
  });
});
