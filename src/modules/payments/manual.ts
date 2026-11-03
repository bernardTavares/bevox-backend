/**
 * Manual Payment Mode (M5-P4 v2) — núcleo PURO (sem IO), unit-testado
 * primeiro (padrão charge-intent.ts/package-intent.ts). Validação de input
 * (REST) + descriptor de payment determinístico p/ applyChargePaid consumir.
 * Org gerencia o dinheiro fora do sistema; Bevox só registra no ledger.
 */
import { z } from "zod";

/** Métodos manuais granulares (NÃO confundir com Stripe 'pix'/'payment_link'). */
export const MANUAL_METHODS = [
  "cash",
  "pix_manual",
  "bank_transfer",
  "boleto_manual",
  "card_manual",
  "other",
] as const;
export type ManualMethod = (typeof MANUAL_METHODS)[number];

const uuid = z.string().uuid();
const manualMethod = z.enum(MANUAL_METHODS);

/** Body de POST /charges/manual. `.strict()` fail-closed. */
export const ManualChargeCreateSchema = z
  .object({
    customer_id: uuid,
    appointment_id: uuid.optional(),
    service_id: uuid.optional(),
    professional_id: uuid.optional(),
    service_package_id: uuid.optional(),
    amount_total: z.number().finite().positive(),
    charge_type: z.union([z.literal("full"), z.literal("package")]),
    currency: z.string().default("BRL"),
    payment_method: manualMethod.optional(),
  })
  .strict()
  .refine((d) => d.charge_type !== "package" || !!d.service_package_id, {
    message: "service_package_id required for charge_type=package",
  });

export type ManualChargeInput = z.infer<typeof ManualChargeCreateSchema>;

export function validateManualChargeInput(
  raw: unknown,
): { success: true; data: ManualChargeInput } | { success: false } {
  const p = ManualChargeCreateSchema.safeParse(raw);
  return p.success ? { success: true, data: p.data } : { success: false };
}

/** Body de POST /charges/:id/mark-paid. */
export const MarkPaidSchema = z
  .object({
    paid_at: z.string().datetime(),
    payment_method: manualMethod,
    reference: z.string().max(200).optional(),
    reason: z.string().min(1).max(500),
  })
  .strict();

export type MarkPaidInput = z.infer<typeof MarkPaidSchema>;

export function validateMarkPaidInput(
  raw: unknown,
): { success: true; data: MarkPaidInput } | { success: false } {
  const p = MarkPaidSchema.safeParse(raw);
  return p.success ? { success: true, data: p.data } : { success: false };
}

/** Body de POST /charges/:id/refund-manual. */
export const ManualRefundSchema = z
  .object({ amount: z.number().finite().positive().optional(), reason: z.string().min(1).max(500) })
  .strict();
export type ManualRefundInput = z.infer<typeof ManualRefundSchema>;
export function validateManualRefundInput(
  raw: unknown,
): { success: true; data: ManualRefundInput } | { success: false } {
  const p = ManualRefundSchema.safeParse(raw);
  return p.success ? { success: true, data: p.data } : { success: false };
}

/** Body de POST /charges/:id/expire. */
export const ManualExpireSchema = z.object({ reason: z.string().min(1).max(500) }).strict();
export function validateManualExpireInput(
  raw: unknown,
): { success: true; data: { reason: string } } | { success: false } {
  const p = ManualExpireSchema.safeParse(raw);
  return p.success ? { success: true, data: p.data } : { success: false };
}

export interface ManualPaymentDescriptor {
  status: "paid";
  providerPaymentId: string;
  amountPaid: number;
  rawPayloadJson: Record<string, unknown>;
}

/**
 * Descriptor determinístico p/ applyChargePaid. provider_payment_id =
 * `manual:<chargeId>` (NÃO uuidv7 fresco) — com a UNIQUE(org,
 * provider_payment_id, status) + ON CONFLICT, retry/double-submit não duplica.
 */
export function buildManualPaymentDescriptor(
  charge: { id: string; organization_id: string; amount_total: string },
  paidAt: Date,
  ctx: { payment_method: ManualMethod; reference?: string; actorId: string },
): ManualPaymentDescriptor {
  return {
    status: "paid",
    providerPaymentId: `manual:${charge.id}`,
    amountPaid: Number(charge.amount_total),
    rawPayloadJson: {
      manual: true,
      payment_method: ctx.payment_method,
      reference: ctx.reference ?? null,
      actor_id: ctx.actorId,
      paid_at: paidAt.toISOString(),
    },
  };
}
