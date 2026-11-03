/**
 * Derivação canônica do onboarding_status (canon §11.1) a partir do objeto
 * Stripe Account. PURO (sem IO) — unit-testado exaustivamente. Precedência:
 * restricted > active(charges∧payouts) > verified > pending.
 * `payouts_enabled` é o sinal de RECEBIMENTO (a conta conectada recebe Pix/
 * cartão e recebe o split via transfer/payout); charges_enabled sozinho não
 * basta p/ "active". currently_due/past_due sem disabled_reason ⇒ verified
 * (enum canônico §11.1 só tem 4 estados — simplificação V1 documentada).
 */
export type OnboardingStatus = "pending" | "verified" | "restricted" | "active";

export interface StripeAccountish {
  charges_enabled: boolean;
  payouts_enabled: boolean;
  details_submitted: boolean;
  // Só `disabled_reason` é lido por deriveOnboardingStatus; o index-sig
  // [k: string]: unknown só existe p/ aceitar props extra do objeto Stripe
  // real (currently_due/past_due/…) sem tipá-las — NÃO é contrato.
  requirements: { disabled_reason?: string | null; [k: string]: unknown } | null;
}

export function deriveOnboardingStatus(a: StripeAccountish): OnboardingStatus {
  const disabled = a.requirements?.disabled_reason;
  if (disabled) return "restricted";
  if (a.charges_enabled && a.payouts_enabled) return "active";
  if (a.details_submitted) return "verified";
  return "pending";
}

/** Espelho cru dos 3 booleans p/ persistir junto (diagnóstico). */
export function stripeAccountMirror(a: StripeAccountish): {
  charges_enabled: boolean;
  payouts_enabled: boolean;
  details_submitted: boolean;
} {
  return {
    charges_enabled: a.charges_enabled,
    payouts_enabled: a.payouts_enabled,
    details_submitted: a.details_submitted,
  };
}
