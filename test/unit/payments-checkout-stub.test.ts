/**
 * POC payment-link-stripe-checkout-not-implemented — foundation tests.
 *
 * O contrato (charge schema) ACEITA payment_method='checkout' (PRD §5.6 /
 * ADR-014) mas o flow Stripe Checkout só é entregue em M5-P5. O stub
 * `createCheckoutSession` é o ponto de bloqueio explícito (501).
 *
 * Testes:
 *  1. Stub sempre rejeita com NOT_IMPLEMENTED (httpStatus 501).
 *  2. seam-tool isola por-proposal (`error` honesto, sem IO).
 */
import { describe, expect, it } from "vitest";

import { isAppError } from "@/shared/errors.js";
import { createCheckoutSession } from "@/modules/payments/checkout.js";
import { handleCreateCharge } from "@/modules/payments/seam-tool.js";

describe("createCheckoutSession (stub — POC foundation)", () => {
  it("sempre lança NOT_IMPLEMENTED (httpStatus 501)", async () => {
    await expect(
      createCheckoutSession({
        organizationId: "org-1",
        chargeId: "chg-1",
        amountTotal: 150,
        feeCents: 0,
        destination: "acct_PRO",
        idempotencyKey: "idem-1",
      }),
    ).rejects.toMatchObject({
      code: "NOT_IMPLEMENTED",
      httpStatus: 501,
    });
  });

  it("lança AppError tipado (mensagem menciona Stripe Checkout + payment_method='checkout')", async () => {
    try {
      await createCheckoutSession({
        organizationId: "org-1",
        chargeId: "chg-1",
        amountTotal: 150,
        feeCents: 0,
        destination: "acct_PRO",
        idempotencyKey: "idem-1",
      });
      throw new Error("expected createCheckoutSession to throw");
    } catch (err) {
      expect(isAppError(err)).toBe(true);
      if (isAppError(err)) {
        expect(err.code).toBe("NOT_IMPLEMENTED");
        expect(err.message).toContain("Stripe Checkout");
        expect(err.message).toContain("checkout");
        expect(err.message).toContain("not yet implemented");
        // details preserva o feature label + lista métodos disponíveis
        expect(err.details).toMatchObject({
          available_methods: ["pix", "manual"],
        });
      }
    }
  });
});

describe("handleCreateCharge — checkout path returns error (no IO)", () => {
  // Seam IA (`bevox-backend/ADR-019`): a IA propõe `payment_method:
  // 'checkout'` (schema aceita), mas o flow só existe em M5-P5. O guard fica
  // ANTES de qualquer IO — não chama createCharge, não toca Stripe/DB.
  it("`payment_method: 'checkout'` ⇒ status='error' (sem chamar createCharge)", async () => {
    const result = await handleCreateCharge(
      "f47ac10b-58cc-4372-a567-0e02b2c3d479",
      {
        customer_id: "f47ac10b-58cc-4372-a567-0e02b2c3d479",
        amount_total: 150,
        charge_type: "full",
        payment_method: "checkout",
      },
      "idem-1",
    );
    expect(result).toEqual({ status: "error" });
  });
});
