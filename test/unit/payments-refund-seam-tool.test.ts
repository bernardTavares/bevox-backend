import { beforeEach, describe, expect, it, vi } from "vitest";

// NOTE vitest: nome do mock DEVE começar com `mock`.
const mockRefundCharge = vi.hoisted(() =>
  vi.fn(async () => ({
    provider_refund_id: "re_1",
    status: "succeeded",
    amount: 40,
    reason_code: "duplicate",
  })),
);
vi.mock("@/modules/payments/service.js", () => ({ refundCharge: mockRefundCharge }));

import { handleCreateRefund } from "@/modules/payments/seam-tool.js";

// UUIDv4-compliant (Zod v4 strict UUID: version nibble=4, variant nibble∈{8-b})
const CID = "11111111-1111-4111-8111-111111111111";
beforeEach(() => vi.clearAllMocks());

describe("handleCreateRefund (P3b seam-tool)", () => {
  it("charge_id ausente/inválido → error sem IO", async () => {
    expect((await handleCreateRefund("org-1", { amount: 40, reason_code: "x" }, "k1")).status).toBe(
      "error",
    );
    expect(mockRefundCharge).not.toHaveBeenCalled();
  });
  it("amount/reason_code inválido → error sem IO", async () => {
    expect((await handleCreateRefund("org-1", { charge_id: CID }, "k1")).status).toBe("error");
    expect(mockRefundCharge).not.toHaveBeenCalled();
  });
  it("válido + aprovador → refundCharge com user + {clerkUserId}, success", async () => {
    const out = await handleCreateRefund(
      "org-1",
      { charge_id: CID, amount: 40, reason_code: "duplicate" },
      "k1",
      "clerk_approver",
    );
    expect(out).toEqual({ status: "success", provider_refund_id: "re_1" });
    expect(mockRefundCharge).toHaveBeenCalledWith(
      "org-1",
      CID,
      { amount: 40, reason_code: "duplicate" },
      "k1",
      "user",
      { clerkUserId: "clerk_approver" },
    );
  });
  it("sem aprovador → system, sem actor", async () => {
    await handleCreateRefund("org-1", { charge_id: CID, amount: 40, reason_code: "x" }, "k1");
    expect(mockRefundCharge).toHaveBeenCalledWith(
      "org-1",
      CID,
      { amount: 40, reason_code: "x" },
      "k1",
      "system",
      undefined,
    );
  });
  it("refundCharge lança → error (nunca propaga)", async () => {
    mockRefundCharge.mockRejectedValueOnce(new Error("boom"));
    expect(
      (
        await handleCreateRefund(
          "org-1",
          { charge_id: CID, amount: 40, reason_code: "x" },
          "k1",
          "clerk",
        )
      ).status,
    ).toBe("error");
  });
});
