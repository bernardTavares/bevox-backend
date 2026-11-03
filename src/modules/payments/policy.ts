/**
 * Payments policy setter — núcleo PURO (sem IO). Valida o body do PATCH
 * /payment-account/policy. SÓ chaves de POLÍTICA per-org; `platform_fee_percent`
 * é Bevox-only e NUNCA aceito aqui (.strict() o rejeita como chave desconhecida).
 * ADR-018 (### 6). `.refine` len≥1 evita PATCH semanticamente vazio mascarar
 * erro de cliente. Mirror de validateChargeInput (charge-intent.ts).
 */
import { z } from "zod";

export const PaymentPolicyPatchSchema = z
  .object({
    no_show_consumes_session: z.boolean().optional(),
  })
  .strict()
  .refine((o) => Object.keys(o).length >= 1, {
    message: "policy patch must set at least one known key",
  });

export type PaymentPolicyPatch = z.infer<typeof PaymentPolicyPatchSchema>;

export function validatePaymentPolicyPatch(
  raw: unknown,
): { success: true; data: PaymentPolicyPatch } | { success: false } {
  const p = PaymentPolicyPatchSchema.safeParse(raw);
  return p.success ? { success: true, data: p.data } : { success: false };
}
