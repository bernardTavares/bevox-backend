/**
 * Handlers das action seams `create-charge` e `create-refund` (canon bevox-backend/ADR-019 —
 * supersedes hub ADR-025; mirror waitlist/seam-tool). Valida params ANTES de
 * qualquer IO → falha = error honesto sem escrita parcial. O idempotency_key
 * vem do harness no Proposal (sempre não-nulo). NÃO lança: o seam isola
 * erro por-proposal (executeProposals captura).
 */
import { z } from "zod";
import { isCheckoutPath, validateChargeInput } from "./charge-intent.js";
import { validateRefundInput } from "./refund-intent.js";
import { createCharge, refundCharge } from "./service.js";

export type CreateChargeOutcome = { status: "success"; charge_id: string } | { status: "error" };

export async function handleCreateCharge(
  organizationId: string,
  rawParams: Record<string, unknown>,
  idempotencyKey: string,
): Promise<CreateChargeOutcome> {
  const v = validateChargeInput(rawParams);
  if (!v.success) return { status: "error" };
  // POC payment-link-stripe-checkout-not-implemented (foundation): a IA
  // pode propor `payment_method: 'checkout'` (schema aceita), mas o flow só
  // existe em M5-P5. Seam isola por-proposal — `error` honesto, sem IO.
  if (isCheckoutPath(v.data)) return { status: "error" };
  try {
    const r = await createCharge(organizationId, v.data, idempotencyKey, "system");
    return { status: "success", charge_id: r.charge_id };
  } catch {
    return { status: "error" };
  }
}

export type CreateRefundOutcome =
  | { status: "success"; provider_refund_id: string }
  | { status: "error" };

const refundChargeIdSchema = z.string().uuid();

/**
 * Handler da action seam `create-refund` (ADR-018 §11; mirror handleCreateCharge).
 * Valida charge_id + {amount, reason_code} ANTES de IO → falha = error honesto.
 * NÃO resolve clerk→users.id (refundCharge resolve). NÃO lança (executeProposals isola).
 */
export async function handleCreateRefund(
  organizationId: string,
  rawParams: Record<string, unknown>,
  idempotencyKey: string,
  approverClerkUserId?: string,
): Promise<CreateRefundOutcome> {
  const cid = refundChargeIdSchema.safeParse(rawParams["charge_id"]);
  if (!cid.success) return { status: "error" };
  const v = validateRefundInput({
    amount: rawParams["amount"],
    reason_code: rawParams["reason_code"],
  });
  if (!v.success) return { status: "error" };
  try {
    const r = await refundCharge(
      organizationId,
      cid.data,
      v.data,
      idempotencyKey,
      approverClerkUserId ? "user" : "system",
      approverClerkUserId ? { clerkUserId: approverClerkUserId } : undefined,
    );
    return { status: "success", provider_refund_id: r.provider_refund_id };
  } catch {
    return { status: "error" };
  }
}
