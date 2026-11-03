import { beforeEach, describe, expect, it, vi } from "vitest";

// NOTE vitest: vars no factory de vi.mock DEVEM começar com `mock`.
vi.mock("@/modules/calendar/google/lock.js", () => ({
  withRedisLock: async (_k: string, _ttl: number, cb: () => Promise<unknown>) => cb(),
}));

// mockStripeCreate is captured OUTSIDE the factory so tests can inspect calls,
// but the factory itself only closes over this module-level vi.fn().
const mockStripeCreate = vi.fn(async () => ({ id: "re_test_1", status: "succeeded" }));
vi.mock("@/modules/payments/stripe-client.js", () => ({
  getStripe: () => ({ refunds: { create: mockStripeCreate } }),
}));

vi.mock("@/modules/payments/repository.js", () => ({
  getChargeById: vi.fn(),
  getRefundByIdempotencyKey: vi.fn(),
  sumNonFailedRefundsCents: vi.fn(),
  getUserIdByClerkId: vi.fn(),
  recordRefund: vi.fn(async () => undefined),
  insertChargeAudit: vi.fn(async () => undefined),
}));

import * as repo from "@/modules/payments/repository.js";
import { refundCharge } from "@/modules/payments/service.js";

const PAID_CHARGE = {
  id: "chg-1",
  status: "paid",
  provider_charge_id: "pi_1",
  amount_total: "100.00",
};

beforeEach(() => {
  vi.clearAllMocks();
  mockStripeCreate.mockResolvedValue({ id: "re_test_1", status: "succeeded" });
  vi.mocked(repo.getChargeById).mockResolvedValue(PAID_CHARGE as never);
  vi.mocked(repo.getRefundByIdempotencyKey).mockResolvedValue(null);
  vi.mocked(repo.sumNonFailedRefundsCents).mockResolvedValue(0);
  vi.mocked(repo.getUserIdByClerkId).mockResolvedValue("user-uuid-1");
});

describe("refundCharge over-refund guard (P3b, replay-safe)", () => {
  it("rejeita quando soma non-failed + amount > total (e não é replay)", async () => {
    vi.mocked(repo.sumNonFailedRefundsCents).mockResolvedValue(6000);
    await expect(
      refundCharge("org-1", "chg-1", { amount: 60, reason_code: "x" }, "idem-1", "user"),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(mockStripeCreate).not.toHaveBeenCalled();
  });

  it("REPLAY (already por idempotency_key) → PULA o guard, não false-rejeita", async () => {
    vi.mocked(repo.sumNonFailedRefundsCents).mockResolvedValue(10000);
    vi.mocked(repo.getRefundByIdempotencyKey).mockResolvedValue({ id: "rf-prev" } as never);
    const r = await refundCharge(
      "org-1",
      "chg-1",
      { amount: 100, reason_code: "x" },
      "idem-1",
      "user",
    );
    expect(r.provider_refund_id).toBe("re_test_1");
    expect(mockStripeCreate).toHaveBeenCalled();
  });

  it("aceita refund dentro do total + atribui o aprovador no audit + grava idempotency_key", async () => {
    const r = await refundCharge(
      "org-1",
      "chg-1",
      { amount: 40, reason_code: "duplicate" },
      "idem-2",
      "user",
      { clerkUserId: "clerk_approver" },
    );
    expect(r.provider_refund_id).toBe("re_test_1");
    expect(repo.getUserIdByClerkId).toHaveBeenCalledWith("org-1", "clerk_approver");
    expect(repo.recordRefund).toHaveBeenCalledWith(
      expect.objectContaining({ idempotencyKey: "idem-2" }),
    );
    expect(repo.insertChargeAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "charge.refund_initiated",
        actorType: "user",
        actorId: "user-uuid-1",
        afterJson: expect.objectContaining({ approved_by_clerk_user_id: "clerk_approver" }),
      }),
    );
  });

  it("sem actor (REST legado) → actorId undefined, sem approved_by", async () => {
    await refundCharge("org-1", "chg-1", { amount: 40, reason_code: "x" }, "idem-3", "user");
    expect(repo.getUserIdByClerkId).not.toHaveBeenCalled();
    const call = vi.mocked(repo.insertChargeAudit).mock.calls[0]![0];
    expect(call.actorId).toBeUndefined();
    expect(call.afterJson).not.toHaveProperty("approved_by_clerk_user_id");
  });
});
