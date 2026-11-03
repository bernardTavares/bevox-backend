import { describe, it, expect } from "vitest";
import {
  validateManualChargeInput,
  validateMarkPaidInput,
  buildManualPaymentDescriptor,
  MANUAL_METHODS,
} from "@/modules/payments/manual.js";

describe("validateManualChargeInput", () => {
  const base = {
    customer_id: "11111111-1111-4111-8111-111111111111",
    amount_total: 120.5,
    charge_type: "full",
  };
  it("accepts a valid full charge with optional pretended method", () => {
    expect(validateManualChargeInput({ ...base, payment_method: "cash" }).success).toBe(true);
  });
  it("requires service_package_id when charge_type=package", () => {
    expect(validateManualChargeInput({ ...base, charge_type: "package" }).success).toBe(false);
  });
  it("accepts package with service_package_id", () => {
    expect(
      validateManualChargeInput({
        ...base,
        charge_type: "package",
        service_package_id: "22222222-2222-4222-8222-222222222222",
      }).success,
    ).toBe(true);
  });
  it("rejects a stripe-only method (pix/payment_link) on a manual charge", () => {
    expect(validateManualChargeInput({ ...base, payment_method: "pix" }).success).toBe(false);
    expect(validateManualChargeInput({ ...base, payment_method: "payment_link" }).success).toBe(
      false,
    );
  });
  it("rejects non-positive amount", () => {
    expect(validateManualChargeInput({ ...base, amount_total: 0 }).success).toBe(false);
  });
});

describe("validateMarkPaidInput", () => {
  it("requires payment_method (effective) and reason", () => {
    expect(
      validateMarkPaidInput({
        paid_at: "2026-05-21T10:00:00Z",
        payment_method: "cash",
        reason: "recebido em dinheiro",
      }).success,
    ).toBe(true);
    expect(
      validateMarkPaidInput({ paid_at: "2026-05-21T10:00:00Z", payment_method: "cash" }).success,
    ).toBe(false);
    expect(validateMarkPaidInput({ paid_at: "2026-05-21T10:00:00Z", reason: "x" }).success).toBe(
      false,
    );
  });
  it("rejects stripe-only payment_method", () => {
    expect(
      validateMarkPaidInput({ paid_at: "2026-05-21T10:00:00Z", payment_method: "pix", reason: "x" })
        .success,
    ).toBe(false);
  });
});

describe("buildManualPaymentDescriptor", () => {
  it("produces a deterministic provider_payment_id = manual:<chargeId>", () => {
    const d = buildManualPaymentDescriptor(
      { id: "ch-1", organization_id: "org-1", amount_total: "120.50" },
      new Date("2026-05-21T10:00:00Z"),
      { payment_method: "cash", reference: "rec#42", actorId: "user-1" },
    );
    expect(d.providerPaymentId).toBe("manual:ch-1");
    expect(d.status).toBe("paid");
    expect(d.amountPaid).toBe(120.5);
    expect(d.rawPayloadJson).toMatchObject({
      manual: true,
      payment_method: "cash",
      reference: "rec#42",
      actor_id: "user-1",
    });
  });
  it("MANUAL_METHODS lists exactly the 6 manual methods", () => {
    expect([...MANUAL_METHODS].sort()).toEqual(
      ["bank_transfer", "boleto_manual", "card_manual", "cash", "other", "pix_manual"].sort(),
    );
  });
});
