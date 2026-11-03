/**
 * Payments P3 — núcleo PURO de refund (sem IO), unit-testado primeiro
 * (padrão charge-intent.ts P2). Validação de input staff/REST; cálculo
 * fail-closed do amount em centavos; montagem determinística de
 * Stripe.RefundCreateParams. Stripe types só como `type` (zero runtime).
 * mapRefundStatus/isFullRefund permanecem em charge-intent.ts — consumidos pela camada de serviço, não duplicados aqui.
 */
import type Stripe from "stripe";
import { z } from "zod";

/**
 * Schema do body de refund (staff/REST). `.strict()` fail-closed
 * (precedente ChargeProposalSchema P2). reason_code obrigatório
 * (PRD §12.5); amount em reais (number positivo finito).
 */
export const RefundRequestSchema = z
  .object({
    amount: z.number().finite().positive(),
    reason_code: z.string().min(1).max(64),
  })
  .strict();

export type RefundInput = z.infer<typeof RefundRequestSchema>;

export function validateRefundInput(
  raw: unknown,
): { success: true; data: RefundInput } | { success: false } {
  const p = RefundRequestSchema.safeParse(raw);
  return p.success ? { success: true, data: p.data } : { success: false };
}

/**
 * Resolve o amount do refund em CENTAVOS a partir do valor em reais que o
 * staff informou e do total da charge. Fail-closed na camada pura (espelha
 * o guard feeCents em [0, amount] do P2 buildPixPaymentIntentParams): só
 * aceita a faixa (0, charge_total] — refund parcial ou total, nunca
 * zero/negativo nem acima do total. Lança RangeError fora dessa faixa.
 */
export function resolveRefundAmountCents(amount: number, chargeAmountTotal: string): number {
  const cents = Math.round(amount * 100);
  const maxCents = Math.round(Number(chargeAmountTotal) * 100);
  if (!Number.isInteger(cents) || !Number.isFinite(maxCents) || cents <= 0 || cents > maxCents) {
    throw new RangeError("refund amount must be in (0, charge total]");
  }
  return cents;
}

/**
 * Monta os params de Stripe refunds.create no destination charge.
 * reverse_transfer + refund_application_fee recuperam fundos da conta
 * conectada e devolvem a fee proporcionalmente (decisão spec-level,
 * canon-silente — ver spec §1.1). Sem `reason` Stripe-enum: o enum Stripe
 * só aceita fraudulent, duplicate ou requested_by_customer; o reason_code
 * livre do produto vai em metadata (PRD §12.5).
 */
export function buildRefundParams(input: {
  providerChargeId: string;
  amountCents: number;
  organizationId: string;
  chargeId: string;
  reasonCode: string;
}): Stripe.RefundCreateParams {
  return {
    payment_intent: input.providerChargeId,
    amount: input.amountCents,
    reverse_transfer: true,
    refund_application_fee: true,
    metadata: {
      organization_id: input.organizationId,
      charge_id: input.chargeId,
      reason_code: input.reasonCode,
    },
  };
}
