/**
 * Payments P2 — núcleo PURO (sem IO), unit-testado primeiro (padrão
 * deriveOnboardingStatus P1). Fee/PI-params determinísticos; validação
 * de input (seam + REST); extração pinada do next_action Pix; mapeamento
 * de status de refund. Stripe types importados só como `type` (zero runtime).
 */
import type Stripe from "stripe";
import { z } from "zod";

/**
 * Teto de política para platform_fee_percent (defensivo). `bevox-backend/ADR-014`
 * (PSP V1 — Stripe Connect, canon; supersede do hub `docs/adr/ADR-010-psp-v1.md`)
 * fixa a fee marketplace da Bevox; `bevox-backend/ADR-018` Amendment 1 (M5-P3a)
 * zera o DEFAULT (monetização = assinatura, `bevox-backend/ADR-023` Manual
 * Payment Mode). Qualquer valor gravado acima de 30% é tratado como config
 * corrompida e cai no fallback default (0). Não é um número canônico — é um
 * guarda fail-closed.
 */
const MAX_PLATFORM_FEE_PERCENT = 30;

/** Lê platform_fee_percent (default 0 se ausente/inválido/fora de política). Fee em CENTAVOS, half-up. */
export function resolvePlatformFee(amountTotal: number, splitConfig: unknown): number {
  let pct = 0;
  if (
    typeof splitConfig === "object" &&
    splitConfig !== null &&
    "platform_fee_percent" in splitConfig
  ) {
    const raw = (splitConfig as { platform_fee_percent: unknown }).platform_fee_percent;
    const n = typeof raw === "number" ? raw : Number(raw);
    // ADR-018 (cascading, ### 4): 0 é override legítimo e DEVE ser preservado
    // → guard n >= 0. Faixa de política plausível mantida (teto MAX); fora da
    // faixa = config corrompida → fallback default (0).
    if (Number.isFinite(n) && n >= 0 && n <= MAX_PLATFORM_FEE_PERCENT) pct = n;
  }
  return Math.round(amountTotal * 100 * (pct / 100));
}

export function buildPixPaymentIntentParams(input: {
  amountTotal: number;
  feeCents: number;
  destination: string;
  organizationId: string;
  chargeId: string;
  idempotencyKey: string;
  expiresAfterSeconds: number;
}): Stripe.PaymentIntentCreateParams {
  const amount = Math.round(input.amountTotal * 100);
  // Invariante Stripe (caminho de dinheiro): application_fee_amount precisa
  // ser inteiro em [0, amount] ou o PaymentIntent é REJEITADO no confirm
  // (falha de pagamento user-facing). feeCents chega opaco do caller →
  // asserir aqui, na camada pura fail-closed, em vez de confiar na disciplina
  // do chamador (base errada / amountTotal stale / charge_type futuro).
  if (!Number.isInteger(input.feeCents) || input.feeCents < 0 || input.feeCents > amount) {
    throw new RangeError("application_fee_amount must be an integer in [0, amount]");
  }
  return {
    amount,
    currency: "brl",
    payment_method_types: ["pix"],
    // P3a: omitir application_fee_amount quando 0 (padrão Stripe canônico p/
    // "sem fee de plataforma"; enviar 0 explícito é ambíguo em algumas configs
    // Connect). A asserção [0, amount] acima permanece p/ callers defensivos.
    ...(input.feeCents > 0 ? { application_fee_amount: input.feeCents } : {}),
    transfer_data: { destination: input.destination },
    metadata: {
      organization_id: input.organizationId,
      charge_id: input.chargeId,
      idempotency_key: input.idempotencyKey,
    },
    payment_method_options: {
      pix: { expires_after_seconds: input.expiresAfterSeconds },
    },
  };
}

const uuid = z.string().uuid();

/**
 * Métodos Stripe-online aceitos pelo endpoint POST /charges (NÃO confundir
 * com manual.ts `MANUAL_METHODS`, que é endpoint separado). V1: só `pix` é
 * provisionado; `checkout` (Stripe Checkout — cartão/boleto, ADR-014 / PRD
 * §5.6) é reconhecido pelo contrato mas ainda não implementado — caller
 * recebe 501 NOT_IMPLEMENTED até M5-P5 entregar o flow completo (sessão +
 * webhook + idempotência).
 */
export const ONLINE_PAYMENT_METHODS = ["pix", "checkout"] as const;
export type OnlinePaymentMethod = (typeof ONLINE_PAYMENT_METHODS)[number];

/**
 * Schema dos params de create-charge (seam IA + REST). `.strict()`
 * fail-closed (precedente waitlist seam-tool). P2: charge_type só `full`/
 * `package`. payment_method aceita `pix` (V1) ou `checkout` (501-stub até
 * M5-P5 — POC payment-link-stripe-checkout-not-implemented). Schema continua
 * validando o enum aqui — o guard de "não implementado" é no caller (route
 * + seam-tool) via `isCheckoutPath`, mantendo o schema como fonte do que
 * o contrato aceita (distinção entre 400 = payload errado e 501 = futuro).
 */
export const ChargeProposalSchema = z
  .object({
    customer_id: uuid,
    appointment_id: uuid.optional(),
    service_id: uuid.optional(),
    professional_id: uuid.optional(),
    service_package_id: uuid.optional(),
    amount_total: z.number().finite().positive(),
    charge_type: z.union([z.literal("full"), z.literal("package")]),
    currency: z.string().default("BRL"),
    payment_method: z.enum(ONLINE_PAYMENT_METHODS).default("pix"),
  })
  .strict();

export type ChargeInput = z.infer<typeof ChargeProposalSchema>;

export function validateChargeInput(
  raw: unknown,
): { success: true; data: ChargeInput } | { success: false } {
  const p = ChargeProposalSchema.safeParse(raw);
  return p.success ? { success: true, data: p.data } : { success: false };
}

/**
 * Sentinel for the checkout path so the caller (route + seam-tool) treats
 * the "not implemented" outcome consistently without re-checking the literal
 * in two places. Returns `true` when the input requests Stripe Checkout —
 * caller MUST surface a NOT_IMPLEMENTED error before any IO.
 */
export function isCheckoutPath(input: Pick<ChargeInput, "payment_method">): boolean {
  return input.payment_method === "checkout";
}

export interface PixDisplay {
  copy_paste: string;
  qr_code: string;
  hosted_instructions_url: string | null;
  expires_at: Date;
}

/**
 * Extrai o QR/copia-e-cola do PaymentIntent Pix. Mapeamento pinado
 * (Stripe `next_action.pix_display_qr_code`): copy_paste←.data,
 * qr_code←.image_url_png, expires_at←.expires_at (unix s → Date).
 */
export function extractPixDisplay(pi: { id: string; next_action?: unknown }): PixDisplay | null {
  const na = pi.next_action as { pix_display_qr_code?: Record<string, unknown> } | null | undefined;
  const q = na?.pix_display_qr_code;
  if (!q || typeof q !== "object") return null;
  const data = q["data"];
  const png = q["image_url_png"];
  const exp = q["expires_at"];
  // expires_at gateia a expiração da charge (caminho de dinheiro): exige
  // unix ts positivo e finito. 0/negativo/NaN ⇒ fail-closed null (não
  // persiste uma charge já-expirada/lixo a partir de payload malformado).
  if (
    typeof data !== "string" ||
    typeof png !== "string" ||
    typeof exp !== "number" ||
    !Number.isFinite(exp) ||
    exp <= 0
  ) {
    return null;
  }
  const hosted = q["hosted_instructions_url"];
  return {
    copy_paste: data,
    qr_code: png,
    hosted_instructions_url: typeof hosted === "string" ? hosted : null,
    expires_at: new Date(exp * 1000),
  };
}

/** Stripe refund.status → enum canon refunds (pending|succeeded|failed). */
export function mapRefundStatus(s: string | null | undefined): "pending" | "succeeded" | "failed" {
  if (s === "succeeded") return "succeeded";
  if (s === "failed" || s === "canceled") return "failed";
  return "pending";
}

/** Refund total = refund.amount (centavos) == charge.amount_total * 100. */
export function isFullRefund(refundAmountCents: number, chargeAmountTotal: string): boolean {
  return refundAmountCents === Math.round(Number(chargeAmountTotal) * 100);
}
