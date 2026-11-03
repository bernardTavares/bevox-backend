/**
 * Stripe Checkout (payment_method='checkout') — foundation stub.
 *
 * POC payment-link-stripe-checkout-not-implemented: PRD §5.6 e
 * `bevox-backend/ADR-014` (PSP V1 — Stripe Connect) listam Checkout
 * (cartão/boleto) como método V1, mas o piloto entregou apenas Pix dinâmico
 * (`charge-intent.ts` antes só aceitava `z.literal('pix')`). Este módulo
 * marca o seam: o enum já aceita `checkout`, o caller resolve via
 * `createCheckoutSession`, e o stub falha-fechado com 501 NOT_IMPLEMENTED
 * até M5-P5 entregar:
 *
 *   1. Provisionamento de `stripe.checkout.sessions.create` (cartão+boleto)
 *      com transfer_data + application_fee_amount no padrão Connect Express.
 *   2. Persistência da `session_id` + `url` por charge (tabela
 *      `checkout_sessions` — migration introduzida nesta foundation, populada
 *      em M5-P5).
 *   3. Webhook `checkout.session.completed` reconciliando a charge para
 *      `paid` (reuse webhook-platform handler com discriminator do evento).
 *   4. Idempotência: `Idempotency-Key` Stripe = `checkout:${chargeId}`
 *      (espelho do pattern Pix `charge:${chargeId}`).
 *
 * O stub NÃO toca DB nem Stripe — é estritamente um marcador de contrato.
 */

import { errors } from "@/shared/errors.js";

export interface CreateCheckoutSessionInput {
  organizationId: string;
  chargeId: string;
  amountTotal: number;
  feeCents: number;
  destination: string;
  idempotencyKey: string;
}

export interface CreateCheckoutSessionResult {
  session_id: string;
  url: string;
  expires_at: string;
}

/**
 * Stub fail-closed. Sempre lança `NOT_IMPLEMENTED` (501). Aceita o input
 * tipado para que o call-site futuro (M5-P5) seja drop-in: troca o corpo
 * por `stripe.checkout.sessions.create(...)` sem mudar assinatura.
 */
export async function createCheckoutSession(
  _input: CreateCheckoutSessionInput,
): Promise<CreateCheckoutSessionResult> {
  throw errors.notImplemented("Stripe Checkout (payment_method='checkout')", {
    follow_up: "M5-P5",
    available_methods: ["pix", "manual"],
  });
}
