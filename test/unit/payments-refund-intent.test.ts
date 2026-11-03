import { describe, expect, it } from "vitest";
import {
  validateRefundInput,
  resolveRefundAmountCents,
  buildRefundParams,
} from "@/modules/payments/refund-intent.js";

describe("validateRefundInput (Zod strict, reason_code obrigatório PRD §12.5)", () => {
  it("aceita amount positivo + reason_code 1..64", () => {
    const r = validateRefundInput({ amount: 50.5, reason_code: "customer_request" });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.amount).toBe(50.5);
      expect(r.data.reason_code).toBe("customer_request");
    }
  });
  it("rejeita amount <= 0", () => {
    expect(validateRefundInput({ amount: 0, reason_code: "x" }).success).toBe(false);
    expect(validateRefundInput({ amount: -1, reason_code: "x" }).success).toBe(false);
  });
  it("rejeita amount não-finito", () => {
    expect(
      validateRefundInput({ amount: Number.POSITIVE_INFINITY, reason_code: "x" }).success,
    ).toBe(false);
  });
  it("rejeita reason_code ausente/vazio (obrigatório)", () => {
    expect(validateRefundInput({ amount: 10 }).success).toBe(false);
    expect(validateRefundInput({ amount: 10, reason_code: "" }).success).toBe(false);
  });
  it("rejeita reason_code > 64 chars", () => {
    expect(validateRefundInput({ amount: 10, reason_code: "x".repeat(65) }).success).toBe(false);
  });
  it("rejeita chave extra desconhecida (strict fail-closed)", () => {
    expect(validateRefundInput({ amount: 10, reason_code: "x", bogus: 1 }).success).toBe(false);
  });
  it("rejeita params vazio", () => {
    expect(validateRefundInput({}).success).toBe(false);
  });
});

describe("resolveRefundAmountCents (fail-closed, faixa (0, charge total])", () => {
  it("refund total = amount == charge total", () => {
    expect(resolveRefundAmountCents(150, "150.00")).toBe(15000);
    expect(resolveRefundAmountCents(150, "150")).toBe(15000);
  });
  it("refund parcial < total", () => {
    expect(resolveRefundAmountCents(50, "150.00")).toBe(5000);
    expect(resolveRefundAmountCents(0.01, "150.00")).toBe(1);
  });
  it("half-up em valor quebrado", () => {
    expect(resolveRefundAmountCents(99.999, "150.00")).toBe(10000);
  });
  it("lança RangeError se amount > charge total", () => {
    expect(() => resolveRefundAmountCents(150.01, "150.00")).toThrow(RangeError);
  });
  it("lança RangeError se amount <= 0", () => {
    expect(() => resolveRefundAmountCents(0, "150.00")).toThrow(RangeError);
    expect(() => resolveRefundAmountCents(-5, "150.00")).toThrow(RangeError);
  });
  it("lança RangeError se charge total não-numérico", () => {
    expect(() => resolveRefundAmountCents(10, "abc")).toThrow(RangeError);
  });
});

describe("buildRefundParams (determinístico, destination charge)", () => {
  it("monta payment_intent + amount + reverse_transfer + refund_application_fee + metadata", () => {
    const p = buildRefundParams({
      providerChargeId: "pi_123",
      amountCents: 5000,
      organizationId: "f47ac10b-58cc-4372-a567-0e02b2c3d479",
      chargeId: "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
      reasonCode: "customer_request",
    });
    expect(p.payment_intent).toBe("pi_123");
    expect(p.amount).toBe(5000);
    expect(p.reverse_transfer).toBe(true);
    expect(p.refund_application_fee).toBe(true);
    expect(p.metadata).toEqual({
      organization_id: "f47ac10b-58cc-4372-a567-0e02b2c3d479",
      charge_id: "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
      reason_code: "customer_request",
    });
    // reason Stripe-enum NÃO setado (reason_code livre do produto vai em metadata).
    expect("reason" in p).toBe(false);
  });
});
