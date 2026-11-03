/**
 * Payments orquestração P1. connectPaymentAccount: get-or-create local →
 * single-flight (withRedisLock fenced, precedente C2) cria a Stripe Express
 * account (capabilities card_payments+pix_payments+transfers; idempotencyKey
 * remoto) → AccountLink. reconcileFromStripe: accounts.retrieve →
 * deriveOnboardingStatus → persiste + audita só na transição. Webhook é a
 * fonte autoritativa; isto cobre o caso user-facing/return.
 */
import type Stripe from "stripe";

import { env } from "@/config/env.js";
import { withRedisLock } from "@/modules/calendar/google/lock.js";
import { errors } from "@/shared/errors.js";
import { logger } from "@/shared/logger.js";

import { getStripe } from "./stripe-client.js";
import * as repo from "./repository.js";
import { deriveOnboardingStatus, stripeAccountMirror } from "./status.js";
import {
  resolvePlatformFee,
  buildPixPaymentIntentParams,
  extractPixDisplay,
  mapRefundStatus,
  type ChargeInput,
} from "./charge-intent.js";
import type { ManualChargeInput, ManualRefundInput, MarkPaidInput } from "./manual.js";
import {
  buildCustomerPackageFromGrant,
  canDecrement,
  toIsoDate,
  type ServicePackageInput,
} from "./package-intent.js";
import { resolveRefundAmountCents, buildRefundParams, type RefundInput } from "./refund-intent.js";
import type { PaymentPolicyPatch } from "./policy.js";

function publicBase(): string {
  const e = env();
  return e.PUBLIC_API_BASE_URL ?? e.HARNESS_CALLBACK_BASE_URL;
}

async function createAccountLink(account: string, orgId: string): Promise<string> {
  const base = publicBase();
  const link = await getStripe().accountLinks.create({
    account,
    type: "account_onboarding",
    return_url: `${base}/api/v1/webhooks/stripe/connect-return?org=${orgId}`,
    refresh_url: `${base}/api/v1/webhooks/stripe/connect-refresh?org=${orgId}`,
  });
  return link.url;
}

export async function connectPaymentAccount(
  orgId: string,
  actorType: "system" | "user",
): Promise<{ onboardingUrl: string; paymentAccountId: string; onboardingStatus: string }> {
  const local = await repo.getOrCreateLocalAccount(orgId);

  let externalId = local.external_account_id;
  if (!externalId) {
    const created = await withRedisLock(`payments:connect:${orgId}`, 30, async () => {
      const fresh = await repo.getByOrg(orgId);
      if (fresh?.external_account_id) return fresh.external_account_id;
      const account = await getStripe().accounts.create(
        {
          type: "express",
          country: "BR",
          capabilities: {
            card_payments: { requested: true },
            pix_payments: { requested: true },
            transfers: { requested: true },
          },
          business_profile: {},
          metadata: { organization_id: orgId },
        },
        { idempotencyKey: `connect:${orgId}` },
      );
      await repo.setExternalAccountId(orgId, local.id, account.id);
      return account.id;
    });
    externalId = created ?? (await repo.getByOrg(orgId))?.external_account_id ?? null;
    // Não conseguiu o lock E ainda sem id persistido: estado transitório
    // — pedir retry honestamente (NUNCA cria conta Stripe fora do lock;
    // o idempotencyKey + lock são a defesa contra conta duplicada).
    if (!externalId) {
      throw errors.upstreamUnavailable(undefined, {
        reason: "stripe_account_creation_in_progress",
        retryable: true,
      });
    }
  }

  const onboardingUrl = await createAccountLink(externalId, orgId);
  await repo.insertPaymentAudit({
    organizationId: orgId,
    paymentAccountId: local.id,
    action: "payment_account.connect_initiated",
    actorType,
    afterJson: { external_account_id: externalId, onboarding_status: local.onboarding_status },
  });
  return {
    onboardingUrl,
    paymentAccountId: local.id,
    onboardingStatus: local.onboarding_status,
  };
}

/** accounts.retrieve → re-deriva → persiste+audita só na transição. */
export async function reconcileFromStripe(
  acct: repo.PaymentAccountRow,
): Promise<repo.OnboardingSnapshot> {
  const before: repo.OnboardingSnapshot = {
    onboarding_status: acct.onboarding_status,
    charges_enabled: acct.charges_enabled,
    payouts_enabled: acct.payouts_enabled,
    details_submitted: acct.details_submitted,
  };
  if (!acct.external_account_id) return before;
  const sa = await getStripe().accounts.retrieve(acct.external_account_id);
  const accountish = {
    charges_enabled: !!sa.charges_enabled,
    payouts_enabled: !!sa.payouts_enabled,
    details_submitted: !!sa.details_submitted,
    requirements: sa.requirements
      ? { disabled_reason: sa.requirements.disabled_reason ?? null }
      : null,
  };
  const after: repo.OnboardingSnapshot = {
    onboarding_status: deriveOnboardingStatus(accountish),
    ...stripeAccountMirror(accountish),
  };
  if (repo.onboardingChanged(before, after)) {
    // M5-P2a Item 4: atomic UPDATE + audit INSERT em single tx — rollback
    // automatic se segundo statement falha (elimina inconsistent state após
    // crash mid-pair). cacheInvalidate dentro de updateOnboardingState roda
    // após o tx.execute (Redis fail-open, não bloqueia COMMIT).
    await repo.withPaymentTx(async (tx) => {
      await repo.updateOnboardingState(acct.organization_id, acct.id, after, tx);
      await repo.insertPaymentAudit(
        {
          organizationId: acct.organization_id,
          paymentAccountId: acct.id,
          action: "payment_account.status_changed",
          actorType: "system",
          afterJson: { ...after },
        },
        tx,
      );
    });
  }
  return after;
}

export async function refreshAccountLink(orgId: string): Promise<string | null> {
  const acct = await repo.getByOrg(orgId);
  if (!acct?.external_account_id) return null;
  return createAccountLink(acct.external_account_id, orgId);
}

export interface PixOut {
  qr_code: string;
  copy_paste: string;
  expires_at: string;
  hosted_instructions_url: string | null;
}

export interface CreateChargeResult {
  charge_id: string;
  status: string;
  // null quando a charge já está em estado terminal (paid/expired/refunded)
  // ou quando o PI não expõe mais next_action — o QR não se aplica e NÃO
  // é erro (replay de uma charge já provisionada).
  pix: PixOut | null;
}

/**
 * Cria uma Charge Pix (destination charge + application_fee). Tripla defesa
 * de idempotência (TODAS efetivas porque setChargeProvider roda DENTRO do
 * lock — o re-check in-lock é load-bearing): unique (organization_id,
 * idempotency_key) + withRedisLock(charge) com persist+audit in-lock +
 * Stripe idempotencyKey `charge:${chargeId}` estável. Guard: payment_account
 * precisa estar `active` e ter external_account_id (sem isso não recebe
 * split). Lock não-adquirido = contenção (409, retryable), não 502. Falha
 * Stripe ⇒ charge fica `pending` (webhook reconcilia).
 */
export async function createCharge(
  orgId: string,
  input: ChargeInput,
  idempotencyKey: string,
  actorType: "system" | "user",
): Promise<CreateChargeResult> {
  const acct = await repo.getByOrg(orgId);
  if (!acct) throw errors.notFound("PaymentAccount", orgId);
  if (acct.onboarding_status !== "active" || !acct.external_account_id) {
    throw errors.invalidInput("payment account not active", {
      onboarding_status: acct.onboarding_status,
    });
  }

  const splitConfig = await repo.getSplitConfig(orgId);
  const feeCents = resolvePlatformFee(input.amount_total, splitConfig);
  // I3: valores de dinheiro vão decimal-safe (string) p/ a coluna
  // numeric(10,2) — evita round-trip por float binário JS.
  const amountTotalDec = input.amount_total.toFixed(2);
  const feeAmountDec = (feeCents / 100).toFixed(2);

  // P4: charge_type='package' requer service_package_id válido org-scoped
  // antes do Stripe call. Mantém validação fail-closed pré-Stripe; sem isso
  // uma charge package paga sem ServicePackage válido falharia silenciosamente
  // no grant (webhook→audit charge.package_grant_skipped) e o customer ficaria
  // pago sem pacote.
  let chargeMetadata: Record<string, unknown> | null = null;
  if (input.charge_type === "package") {
    if (!input.service_package_id) {
      throw errors.invalidInput("service_package_id required for charge_type=package");
    }
    const sp = await repo.getServicePackageById(orgId, input.service_package_id);
    if (!sp) throw errors.notFound("ServicePackage", input.service_package_id);
    if (!sp.is_active) {
      throw errors.invalidInput("service_package inactive", {
        service_package_id: input.service_package_id,
      });
    }
    chargeMetadata = { service_package_id: input.service_package_id };
  }

  const { id: chargeId } = await repo.insertChargePending({
    organizationId: orgId,
    customerId: input.customer_id,
    appointmentId: input.appointment_id ?? null,
    serviceId: input.service_id ?? null,
    professionalId: input.professional_id ?? null,
    paymentAccountId: acct.id,
    amountTotal: amountTotalDec,
    amountPlatformFee: feeAmountDec,
    currency: input.currency,
    idempotencyKey,
    chargeType: input.charge_type,
    paymentMethod: "pix",
    metadata: chargeMetadata,
  });

  const toPix = (d: {
    qr_code: string;
    copy_paste: string;
    expires_at: Date;
    hosted_instructions_url: string | null;
  }): PixOut => ({
    qr_code: d.qr_code,
    copy_paste: d.copy_paste,
    expires_at: d.expires_at.toISOString(),
    hosted_instructions_url: d.hosted_instructions_url,
  });

  // Resolve uma charge JÁ provisionada (qualquer chamada anterior concluída).
  // Estado terminal (não-pending) ⇒ QR não se aplica → pix:null (NÃO 502,
  // NÃO eco de status stale com QR fresco — I2). Pending com PI ⇒ re-busca QR.
  const resolveProvisioned = async (row: repo.ChargeRow): Promise<CreateChargeResult> => {
    if (row.status !== "pending") {
      return { charge_id: row.id, status: row.status, pix: null };
    }
    const pi = await getStripe().paymentIntents.retrieve(row.provider_charge_id as string);
    const d = extractPixDisplay(pi as unknown as { id: string; next_action?: unknown });
    return { charge_id: row.id, status: row.status, pix: d ? toPix(d) : null };
  };

  const existing = await repo.getChargeById(orgId, chargeId);
  if (existing?.provider_charge_id) {
    return resolveProvisioned(existing);
  }

  const expiresAfter = env().PAYMENTS_PIX_EXPIRES_SECONDS;
  // C1: criar PI + setChargeProvider + audit TODOS dentro do lock, para que
  // o re-check in-lock (cur.provider_charge_id) seja realmente load-bearing
  // — fecha a janela orphaned-PI da Task 3 (não degrada p/ defesa Stripe-só).
  const result = await withRedisLock(
    `payments:charge:${chargeId}`,
    30,
    async (): Promise<CreateChargeResult> => {
      const cur = await repo.getChargeById(orgId, chargeId);
      if (cur?.provider_charge_id) {
        return resolveProvisioned(cur);
      }
      const created = await getStripe().paymentIntents.create(
        buildPixPaymentIntentParams({
          amountTotal: input.amount_total,
          feeCents,
          destination: acct.external_account_id!,
          organizationId: orgId,
          chargeId,
          idempotencyKey,
          expiresAfterSeconds: expiresAfter,
        }),
        { idempotencyKey: `charge:${chargeId}` },
      );
      const d = extractPixDisplay(created as unknown as { id: string; next_action?: unknown });
      // Orphan-avoidance: persistir provider_charge_id IN-LOCK sempre — o
      // webhook platform precisa resolver a charge por provider_charge_id
      // mesmo se a extração do display vier anômala. expires_at = da
      // resposta Stripe quando presente (BLOCKER spec), senão NULL.
      await repo.setChargeProvider(chargeId, created.id, d ? d.expires_at : null);
      await repo.insertChargeAudit({
        organizationId: orgId,
        chargeId,
        action: "charge.created",
        actorType,
        afterJson: {
          provider_charge_id: created.id,
          amount_total: amountTotalDec,
          amount_platform_fee: feeAmountDec,
          payment_method: "pix",
        },
      });
      return {
        charge_id: chargeId,
        status: "pending",
        pix: d ? toPix(d) : null,
      };
    },
  );

  // I1: lock não-adquirido = contenção interna (outra request em voo p/ esta
  // charge), NÃO falha de upstream. 409 retryable, não 502 (não polui SLO
  // de upstream-availability). Charge fica `pending` sem provider — seguro.
  if (!result) {
    throw errors.conflict("charge creation in progress", { retryable: true });
  }
  return result;
}

/**
 * M5-P4 Manual Payment Mode: cria uma charge `pending` SEM chamar o Stripe.
 * A org gerencia o dinheiro fora do sistema (cash, pix manual, transferência);
 * Bevox só registra no ledger. Pré-condição: a org tem uma payment_account
 * manual configurada (provider='manual', account_holder_type='organization').
 * Sem ela → invalidInput (não notFound: a org pode ter conta Stripe e ainda
 * assim não ter habilitado o modo manual).
 *
 * Idempotência: insertChargePending dedupe por (organization_id,
 * idempotency_key) — re-submit retorna a charge existente. Sem provider call,
 * sem lock (não há recurso externo a serializar). charge_type='package' exige
 * service_package_id válido+ativo org-scoped (mesmo guard fail-closed pré-grant
 * de createCharge); o id vai p/ metadata p/ o grant on-paid resolver.
 */
export async function createManualCharge(
  orgId: string,
  input: ManualChargeInput,
  idempotencyKey: string,
  actor: { clerkUserId: string },
): Promise<{ charge_id: string; status: string }> {
  const acct = await repo.getManualAccount(orgId);
  if (!acct) throw errors.invalidInput("manual payment account not configured");

  // Padrão "actor audit" (reusado pelas demais ações manuais): audit_events.
  // actor_id é coluna `uuid`; o ator na rota é o clerk_user_id (NÃO uuid).
  // Resolve users.id uma vez; NULL se o user não existe no DB (auditável via
  // actor_clerk_user_id no after_json, que sobrevive mesmo sem resolução).
  const actorUserId = await repo.getUserIdByClerkId(orgId, actor.clerkUserId);

  let chargeMetadata: Record<string, unknown> | null = null;
  if (input.charge_type === "package") {
    if (!input.service_package_id) {
      throw errors.invalidInput("service_package_id required for charge_type=package");
    }
    const sp = await repo.getServicePackageById(orgId, input.service_package_id);
    if (!sp) throw errors.notFound("ServicePackage", input.service_package_id);
    if (!sp.is_active) throw errors.invalidInput("service_package inactive");
    chargeMetadata = { service_package_id: input.service_package_id };
  }

  const { id: chargeId } = await repo.insertChargePending({
    organizationId: orgId,
    customerId: input.customer_id,
    appointmentId: input.appointment_id ?? null,
    serviceId: input.service_id ?? null,
    professionalId: input.professional_id ?? null,
    paymentAccountId: acct.id,
    amountTotal: input.amount_total.toFixed(2),
    amountPlatformFee: null,
    currency: input.currency,
    idempotencyKey,
    chargeType: input.charge_type,
    paymentMethod: input.payment_method ?? null,
    metadata: chargeMetadata,
  });

  await repo.insertChargeAudit({
    organizationId: orgId,
    chargeId,
    action: "charge.created_manual",
    actorType: "user",
    actorId: actorUserId ?? undefined,
    afterJson: {
      amount_total: input.amount_total.toFixed(2),
      payment_method: input.payment_method ?? null,
      // Trilha sobrevive mesmo se a resolução clerk_user_id → users.id voltar
      // NULL (user fora do DB / clerk-only): o clerk id fica no after_json.
      actor_clerk_user_id: actor.clerkUserId,
    },
  });
  return { charge_id: chargeId, status: "pending" };
}

/**
 * M5-P4 Manual Payment Mode: staff/user marca uma charge manual como paga.
 * Converge para os MESMOS efeitos downstream do Stripe paid path via
 * applyChargePaid (markChargePaid guarded → insertPayment ON CONFLICT →
 * confirmAppointmentIfUnconfirmed → audit → re-load → grant best-effort).
 *
 * Guards fail-closed: charge existe (org-scoped) + a charge pertence à conta
 * manual da org (não-manual → invalidInput; mistura Stripe/manual seria bug
 * de ledger). Idempotência: NÃO vem do lock (que é só contention-optimizer)
 * mas da construção de applyChargePaid — markChargePaid guarded (status=
 * 'pending'), provider_payment_id determinístico `manual:<chargeId>` +
 * insertPayment ON CONFLICT, e grant insert-once. Double-submit/re-mark
 * legítimo converge sem duplicar. NÃO adicionar um status pre-check gate que
 * bloquearia re-marks idempotentes.
 *
 * Padrão "actor audit" (Task 6): o ator na rota é o clerk_user_id; resolve
 * users.id (uuid) p/ audit_events.actor_id (coluna uuid); o clerk id também
 * vai p/ rawPayloadJson.actor_id do payment (campo informacional jsonb).
 */
export async function markChargePaidManually(
  orgId: string,
  chargeId: string,
  input: MarkPaidInput,
  actor: { clerkUserId: string },
): Promise<{ charge_id: string; status: string }> {
  const charge = await repo.getChargeById(orgId, chargeId);
  if (!charge) throw errors.notFound("Charge", chargeId);
  const acct = await repo.getManualAccount(orgId);
  if (!acct || charge.payment_account_id !== acct.id) {
    throw errors.invalidInput("charge is not a manual charge");
  }
  const actorUserId = await repo.getUserIdByClerkId(orgId, actor.clerkUserId);
  const paidAt = new Date(input.paid_at);
  const { buildManualPaymentDescriptor } = await import("./manual.js");
  const descriptor = buildManualPaymentDescriptor(charge, paidAt, {
    payment_method: input.payment_method,
    reference: input.reference,
    actorId: actor.clerkUserId,
  });
  const out = await withRedisLock(`payments:manual-paid:${chargeId}`, 30, async () => {
    await applyChargePaid(
      orgId,
      charge,
      paidAt,
      { ...descriptor, currency: charge.currency },
      {
        action: "charge.marked_paid_manual",
        actorType: "user",
        actorId: actorUserId ?? undefined,
        reason: input.reason,
      },
    );
    return true;
  });
  // Lock não-adquirido = outra request de mark-paid em voo p/ esta charge:
  // contenção interna, 409 retryable (a correção de idempotência vem dos
  // efeitos individualmente idempotentes de applyChargePaid, não do lock).
  if (!out) throw errors.conflict("mark-paid in progress", { retryable: true });
  const fresh = await repo.getChargeById(orgId, chargeId);
  return { charge_id: chargeId, status: fresh?.status ?? "paid" };
}

/**
 * M5-P4 Manual Payment Mode (Task 8): staff/user registra um estorno MANUAL de
 * uma charge `paid` (a org já devolveu o dinheiro out-of-band; Bevox só grava
 * no ledger). Converge p/ os mesmos efeitos pós-refund do Stripe path via
 * applyChargeRefunded (recomputa full-vs-partial da SOMA persistida de refunds
 * 'succeeded'); em full → markChargeRefunded + markPaymentReversed + cancel
 * package. Guards fail-closed: charge existe (org-scoped), pertence à conta
 * manual da org (não-manual → invalidInput; mistura Stripe/manual = bug de
 * ledger), está `paid` (refundável), e amount ∈ (0, total] (pre-lock).
 *
 * C1 (double-count hazard — defesa MANDATÓRIA):
 *  1. provider_refund_id DETERMINÍSTICO da idempotency-key:
 *     `manual:refund:${chargeId}:${idemKey}`. NUNCA Date.now()/random. Replay
 *     da MESMA key → MESMO id → o dedupe de recordRefund colapsa p/ UMA row;
 *     refunds legítimos distintos usam keys distintas.
 *  2. Over-refund guard DENTRO do lock: re-lê sumSucceededRefundsCents; se este
 *     refund id NÃO está registrado E priorCents + amountCents > totalCents →
 *     invalidInput. Um replay verdadeiro (id já registrado) NÃO lança — é
 *     idempotente. O throw propaga p/ fora de withRedisLock (try/finally; o
 *     finally só faz release fenced, não engole erro) — verificado em lock.ts.
 */
export async function refundChargeManually(
  orgId: string,
  chargeId: string,
  input: ManualRefundInput,
  idemKey: string,
  actor: { clerkUserId: string },
): Promise<{ status: string; amount: number }> {
  const charge = await repo.getChargeById(orgId, chargeId);
  if (!charge) throw errors.notFound("Charge", chargeId);
  const acct = await repo.getManualAccount(orgId);
  if (!acct || charge.payment_account_id !== acct.id) {
    throw errors.invalidInput("charge is not a manual charge");
  }
  if (charge.status !== "paid") {
    throw errors.invalidInput("charge not refundable", { status: charge.status });
  }
  const totalCents = Math.round(Number(charge.amount_total) * 100);
  const amountCents = input.amount !== undefined ? Math.round(input.amount * 100) : totalCents;
  if (amountCents <= 0 || amountCents > totalCents) {
    throw errors.invalidInput("refund amount out of range");
  }
  // C1: id determinístico da idempotency-key (replay → mesmo id → dedupe).
  const providerRefundId = `manual:refund:${chargeId}:${idemKey}`;
  const actorUserId = await repo.getUserIdByClerkId(orgId, actor.clerkUserId);
  const out = await withRedisLock(`payments:manual-refund:${chargeId}`, 30, async () => {
    const priorCents = await repo.sumSucceededRefundsCents(orgId, chargeId);
    const already = await repo.getRefundByProviderId(orgId, providerRefundId);
    // Over-refund guard: rejeita só se NÃO é replay (id já registrado é
    // idempotente, NÃO lança) E a soma cumulativa estouraria o total.
    if (!already && priorCents + amountCents > totalCents) {
      throw errors.invalidInput("refund exceeds charge total", {
        prior: priorCents / 100,
        requested: amountCents / 100,
        total: totalCents / 100,
      });
    }
    await repo.recordRefund({
      organizationId: orgId,
      chargeId,
      status: "succeeded",
      amount: amountCents / 100,
      providerRefundId,
    });
    await applyChargeRefunded(orgId, charge, {
      action: "charge.refunded_manual",
      actorType: "user",
      actorId: actorUserId ?? undefined,
      reason: input.reason,
      providerRefundId,
    });
    await repo.insertChargeAudit({
      organizationId: orgId,
      chargeId,
      action: "charge.refunded_manual",
      actorType: "user",
      actorId: actorUserId ?? undefined,
      reasonText: input.reason,
      afterJson: {
        amount: amountCents / 100,
        provider_refund_id: providerRefundId,
        actor_clerk_user_id: actor.clerkUserId,
      },
    });
    return true;
  });
  // Lock não-adquirido = outra request de refund manual em voo p/ esta charge:
  // contenção interna, 409 retryable (a correção de double-count vem do id
  // determinístico + dedupe + over-refund guard, não do lock).
  if (!out) throw errors.conflict("refund in progress", { retryable: true });
  const fresh = await repo.getChargeById(orgId, chargeId);
  return { status: fresh?.status ?? charge.status, amount: amountCents / 100 };
}

/**
 * M5-P3a: lê a política de pagamento efetiva per-org (GET). Coerce a fee de
 * string (pg numeric) p/ number na resposta JSON. Shape compartilhada com o
 * retorno do PATCH (paridade PATCH↔GET).
 */
export async function readPaymentAccountPolicy(
  orgId: string,
): Promise<{ no_show_consumes_session: boolean; platform_fee_percent: number }> {
  const p = await repo.getPaymentAccountPolicy(orgId);
  return {
    no_show_consumes_session: p.no_show_consumes_session,
    platform_fee_percent: Number(p.platform_fee_percent),
  };
}

/**
 * M5-P3a: seta chaves de política per-org (PATCH). Uma transação (withPaymentTx):
 * MERGE (CTE before+after) → audit com actor resolvido. Sem conta org-level →
 * notFound (404). Padrão "actor audit" (clerk→users.id; clerk id sobrevive em
 * after_json mesmo se a resolução voltar NULL). Retorna a política efetiva
 * (fresh read) p/ paridade de shape com o GET.
 */
export async function setPaymentAccountPolicy(
  orgId: string,
  patch: PaymentPolicyPatch,
  actor: { clerkUserId: string },
): Promise<{ no_show_consumes_session: boolean; platform_fee_percent: number }> {
  const actorUserId = await repo.getUserIdByClerkId(orgId, actor.clerkUserId);
  const merged = await repo.withPaymentTx(async (tx) => {
    const res = await repo.updatePaymentAccountPolicy(orgId, patch, tx);
    if (!res) return null;
    await repo.insertPaymentAudit(
      {
        organizationId: orgId,
        paymentAccountId: res.accountId,
        action: "payment_account.policy_updated",
        actorType: "user",
        actorId: actorUserId ?? undefined,
        afterJson: {
          before: res.before,
          after: res.after,
          patch,
          actor_clerk_user_id: actor.clerkUserId,
        },
      },
      tx,
    );
    return res;
  });
  if (!merged) throw errors.notFound("PaymentAccount", orgId);
  return readPaymentAccountPolicy(orgId);
}

/**
 * M5-P4 Manual Payment Mode (Task 9): staff/user marca uma charge manual
 * `pending` como `expired`. Charges manuais têm expires_at=NULL (nunca
 * auto-expiram); este é o ÚNICO caminho de expiry delas. Guards fail-closed:
 * charge existe (org-scoped), pertence à conta manual da org (não-manual →
 * invalidInput; mistura Stripe/manual = bug de ledger), e está `pending`
 * (só pending→expired). markChargeExpired é a transição guardada org-scoped.
 *
 * Padrão "actor audit" (Tasks 6-8): o ator na rota é o clerk_user_id; resolve
 * users.id (uuid) p/ audit_events.actor_id; o clerk id sobrevive no after_json.
 */
export async function expireChargeManually(
  orgId: string,
  chargeId: string,
  input: { reason: string },
  actor: { clerkUserId: string },
): Promise<{ status: string }> {
  const charge = await repo.getChargeById(orgId, chargeId);
  if (!charge) throw errors.notFound("Charge", chargeId);
  const acct = await repo.getManualAccount(orgId);
  if (!acct || charge.payment_account_id !== acct.id) {
    throw errors.invalidInput("charge is not a manual charge");
  }
  if (charge.status !== "pending") {
    throw errors.invalidInput("charge not expirable", { status: charge.status });
  }
  const actorUserId = await repo.getUserIdByClerkId(orgId, actor.clerkUserId);
  await repo.markChargeExpired(orgId, chargeId);
  await repo.insertChargeAudit({
    organizationId: orgId,
    chargeId,
    action: "charge.expired_manual",
    actorType: "user",
    actorId: actorUserId ?? undefined,
    reasonText: input.reason,
    afterJson: { status: "expired", actor_clerk_user_id: actor.clerkUserId },
  });
  return { status: "expired" };
}

/**
 * M5-P4 Manual Payment Mode (Task 10): onboarding do modo manual. Cria
 * (idempotente) a payment_account provider='manual' org-level, ATIVA
 * imediatamente — sem Stripe Connect / KYC. É o que a org escolhe quando
 * gerencia o dinheiro fora-de-banda (cash, pix manual, transferência);
 * Bevox só registra no ledger. createManualAccount é idempotente
 * (SELECT-guard + ON CONFLICT DO NOTHING) → re-chamadas devolvem a MESMA
 * conta. Audit payment_account.manual_configured: o ator na rota é o
 * clerk_user_id; vai p/ after_json.actor_clerk_user_id (insertPaymentAudit
 * hardcoda actor_id NULL — o ator de onboarding é menos crítico que o audit
 * de estado-de-dinheiro, que resolve users.id).
 */
export async function connectManualAccount(
  orgId: string,
  actor: { clerkUserId: string },
): Promise<{ paymentAccountId: string; onboardingStatus: string }> {
  const acct = await repo.createManualAccount(orgId);
  await repo.insertPaymentAudit({
    organizationId: orgId,
    paymentAccountId: acct.id,
    action: "payment_account.manual_configured",
    actorType: "user",
    afterJson: {
      provider: "manual",
      onboarding_status: "active",
      actor_clerk_user_id: actor.clerkUserId,
    },
  });
  return { paymentAccountId: acct.id, onboardingStatus: acct.onboarding_status };
}

export interface RefundResult {
  provider_refund_id: string;
  status: "pending" | "succeeded" | "failed";
  amount: number;
  reason_code: string;
}

/**
 * Inicia um estorno (full ou partial) sobre uma charge `paid`. Guards
 * fail-closed antes de qualquer Stripe (charge paga e com provider_charge_id
 * e amount na faixa (0, total]); withRedisLock por-charge serializa refund
 * in-flight; Stripe idempotencyKey estável `refund:${chargeId}:${idemKey}`
 * faz o Stripe REPLAY o resultado original num retry (nunca um 2º
 * refund/transfer-reversal) — logo 502 retryable é seguro por construção.
 * A iniciação NÃO marca charge.refunded/payment.reversed — só cria o refund
 * no Stripe e grava o refund (pending ou succeeded, conforme o Stripe
 * retornar). O webhook reconcilia autoritativamente (spec §4); convergência
 * por provider_refund_id. Lock não-adquirido = contenção (409 retryable,
 * não 502). Recuperação de fundos incompleta (saldo conectado negativo) =
 * registrado, não-fatal, follow-on RefundPolicy ADR (spec §1.2).
 * Nota: a segurança sob lock-overrun (TTL 30s) vem do idempotencyKey Stripe
 * (replay server-side), NÃO do TTL — não "afinar" o TTL achando que ele
 * limita double-refund.
 * P3b: guard de over-refund replay-safe DENTRO do lock (espelho do caminho
 * manual ~511-521): `getRefundByIdempotencyKey` detecta replay → pula o
 * guard; caso contrário `sumNonFailedRefundsCents + amountCents > totalCents`
 * → INVALID_INPUT (fecha over-refund por parciais distintos REST+seam).
 * actor?:{clerkUserId} → audit actor_id + approved_by_clerk_user_id;
 * omitido (REST legado) → actorId undefined, sem approved_by.
 */
export async function refundCharge(
  orgId: string,
  chargeId: string,
  input: RefundInput,
  idempotencyKey: string,
  actorType: "system" | "user",
  actor?: { clerkUserId?: string },
): Promise<RefundResult> {
  const charge = await repo.getChargeById(orgId, chargeId);
  if (!charge) throw errors.notFound("Charge", chargeId);
  if (charge.status !== "paid") {
    throw errors.invalidInput("charge not refundable", { status: charge.status });
  }
  if (!charge.provider_charge_id) {
    throw errors.invalidInput("charge has no payment intent");
  }
  let amountCents: number;
  try {
    amountCents = resolveRefundAmountCents(input.amount, charge.amount_total);
  } catch {
    throw errors.invalidInput("invalid refund amount", {
      amount: input.amount,
      charge_total: charge.amount_total,
    });
  }

  const totalCents = Math.round(Number(charge.amount_total) * 100);
  const actorUserId = actor?.clerkUserId
    ? await repo.getUserIdByClerkId(orgId, actor.clerkUserId)
    : null;

  const result = await withRedisLock(
    `payments:refund:${chargeId}`,
    30,
    async (): Promise<RefundResult> => {
      // P3b: guard de over-refund replay-safe (DENTRO do lock → atômico; mirror manual
      // service.ts ~511-521). `already` por idempotency_key → replay → PULA o guard (Stripe
      // idempotencyKey + recordRefund ON CONFLICT garantem zero double-money).
      const already = await repo.getRefundByIdempotencyKey(orgId, chargeId, idempotencyKey);
      const priorCents = await repo.sumNonFailedRefundsCents(orgId, chargeId);
      if (!already && priorCents + amountCents > totalCents) {
        throw errors.invalidInput("refund exceeds charge total", {
          prior: priorCents / 100,
          requested: amountCents / 100,
          total: totalCents / 100,
        });
      }

      let rf: Stripe.Refund;
      try {
        rf = await getStripe().refunds.create(
          buildRefundParams({
            providerChargeId: charge.provider_charge_id as string,
            amountCents,
            organizationId: orgId,
            chargeId,
            reasonCode: input.reason_code,
          }),
          { idempotencyKey: `refund:${chargeId}:${idempotencyKey}` },
        );
      } catch (err) {
        throw errors.upstreamUnavailable(err, {
          reason: "stripe_refund_failed",
          retryable: true,
        });
      }
      const status = mapRefundStatus(rf.status);
      const amount = amountCents / 100;
      await repo.recordRefund({
        organizationId: orgId,
        chargeId,
        status,
        amount,
        providerRefundId: rf.id,
        idempotencyKey,
      });
      await repo.insertChargeAudit({
        organizationId: orgId,
        chargeId,
        action: "charge.refund_initiated",
        actorType,
        actorId: actorUserId ?? undefined,
        afterJson: {
          provider_refund_id: rf.id,
          amount,
          reason_code: input.reason_code,
          status,
          ...(actor?.clerkUserId ? { approved_by_clerk_user_id: actor.clerkUserId } : {}),
        },
      });
      return {
        provider_refund_id: rf.id,
        status,
        amount,
        reason_code: input.reason_code,
      };
    },
  );

  // Lock não-adquirido = outra request de refund em voo p/ esta charge:
  // contenção interna, 409 retryable (não 502; não polui SLO de upstream).
  if (!result) {
    throw errors.conflict("refund already in progress", { retryable: true });
  }
  return result;
}

// ============================================================================
// Packages P4 — ServicePackage catálogo + grant on paid + decrement on completed.
// ============================================================================

/**
 * Cria um ServicePackage no catálogo (REST POST /service-packages).
 * Sem lock (catálogo aberto, INSERT não corre com nada). Audit
 * service_package.created via insertServicePackageAudit.
 */
export async function createServicePackage(
  orgId: string,
  input: ServicePackageInput,
  actorType: "system" | "user",
): Promise<{ service_package_id: string }> {
  const { id } = await repo.insertServicePackage({
    organizationId: orgId,
    name: input.name,
    serviceId: input.service_id ?? null,
    sessionsIncluded: input.sessions_included,
    priceAmount: input.price_amount,
    validityDays: input.validity_days ?? null,
  });
  await repo.insertServicePackageAudit({
    organizationId: orgId,
    servicePackageId: id,
    action: "service_package.created",
    actorType,
    afterJson: {
      name: input.name,
      sessions_included: input.sessions_included,
      price_amount: input.price_amount,
      validity_days: input.validity_days ?? null,
    },
  });
  return { service_package_id: id };
}

export interface GrantResult {
  customerPackageId: string;
  granted: boolean;
}

export interface ApplyPaidCtx {
  action: "charge.paid" | "charge.marked_paid_manual";
  actorType: "system" | "user";
  actorId?: string;
  reason?: string;
}

/**
 * Orquestração pós-pago compartilhada (Stripe webhook + manual). Os SEIS
 * efeitos do branch payment_intent.succeeded, incondicionais e individualmente
 * idempotentes: markChargePaid (guarded) → insertPayment (dedupe+UNIQUE ON
 * CONFLICT) → confirmAppointmentIfUnconfirmed → audit → re-load → grant
 * (package, best-effort). Callers diferem só no descriptor + ctx.
 */
export async function applyChargePaid(
  orgId: string,
  chargeRow: repo.ChargeRow,
  paidAt: Date,
  paymentDescriptor: {
    status: "paid";
    providerPaymentId: string;
    amountPaid: number;
    currency: string;
    rawPayloadJson: Record<string, unknown>;
  },
  ctx: ApplyPaidCtx,
): Promise<void> {
  const chargeId = chargeRow.id;
  await repo.markChargePaid(orgId, chargeId, paidAt);
  await repo.insertPayment({
    organizationId: orgId,
    chargeId,
    status: "paid",
    providerPaymentId: paymentDescriptor.providerPaymentId,
    amountPaid: paymentDescriptor.amountPaid,
    currency: paymentDescriptor.currency,
    paidAt,
    rawPayloadJson: paymentDescriptor.rawPayloadJson,
  });
  if (chargeRow.appointment_id) {
    await repo.confirmAppointmentIfUnconfirmed(orgId, chargeRow.appointment_id);
  }
  await repo.insertChargeAudit({
    organizationId: orgId,
    chargeId,
    action: ctx.action,
    actorType: ctx.actorType,
    actorId: ctx.actorId,
    reasonText: ctx.reason,
    afterJson: { provider_payment_id: paymentDescriptor.providerPaymentId, status: "paid" },
  });
  // Re-load chargeRow APÓS markChargePaid p/ ter paid_at populado
  // (buildCustomerPackageFromGrant exige paid_at quando validity_days set).
  if (chargeRow.charge_type === "package") {
    const paidCharge = await repo.getChargeById(orgId, chargeId);
    if (paidCharge) {
      try {
        await grantCustomerPackageFromPaidCharge(orgId, paidCharge);
      } catch (err) {
        logger().warn({ chargeId, err }, "grant unexpected throw (caller contract preserved)");
      }
    }
  }
}

export interface ApplyRefundedCtx {
  action: "charge.refund_recorded" | "charge.refunded_manual";
  actorType: "system" | "user";
  actorId?: string;
  reason?: string;
  providerRefundId?: string;
}

/**
 * Orquestração pós-refund compartilhada (Stripe webhook + manual). Recomputa
 * full-vs-partial das refund rows PERSISTIDAS (cumulativo, cents-inteiro) via
 * sumSucceededRefundsCents — preserva o gate de status-persistido (só rows
 * 'succeeded' contam) p/ ambos callers, e corrige o caso "dois parciais que
 * somam o total = full". Em full: markChargeRefunded → markPaymentReversed →
 * cancel package (best-effort). NÃO emite o audit final (caller-owned).
 */
export async function applyChargeRefunded(
  orgId: string,
  chargeRow: repo.ChargeRow,
  ctx: ApplyRefundedCtx,
): Promise<void> {
  const chargeId = chargeRow.id;
  const refundedCents = await repo.sumSucceededRefundsCents(orgId, chargeId);
  const totalCents = Math.round(Number(chargeRow.amount_total) * 100);
  if (refundedCents >= totalCents) {
    await repo.markChargeRefunded(orgId, chargeId);
    await repo.markPaymentReversed(orgId, chargeId);
    if (chargeRow.charge_type === "package") {
      try {
        const out = await repo.cancelCustomerPackageByChargeId(orgId, chargeId);
        if (out.cancelled) {
          const cp = await repo.getCustomerPackageByChargeId(orgId, chargeId);
          if (cp) {
            await repo.insertPackageAudit({
              organizationId: orgId,
              customerPackageId: cp.id,
              action: "package.cancelled",
              actorType: ctx.actorType,
              afterJson: {
                reason: "refund_full",
                charge_id: chargeId,
                provider_refund_id: ctx.providerRefundId ?? null,
              },
            });
          }
        }
      } catch (err) {
        logger().warn(
          { chargeId, err },
          "package cancel unexpected throw (caller contract preserved)",
        );
      }
    }
  }
}

/**
 * Concede CustomerPackage idempotente quando uma charge_type='package' é
 * paga (chamado pelo webhook payment_intent.succeeded branch P4). Lock
 * por-charge serializa reentrega concorrente do MESMO event. Fail-closed
 * em todas as precondições: ausente customer_id, ausente service_package_id
 * no metadata, ServicePackage inválido/inactive — audit
 * charge.package_grant_skipped (entity_type='charge') e return granted=false
 * SEM propagar (webhook 200; observable via audit).
 */
export async function grantCustomerPackageFromPaidCharge(
  orgId: string,
  chargeRow: repo.ChargeRow,
): Promise<GrantResult> {
  const result = await withRedisLock(
    `payments:grant-package:${chargeRow.id}`,
    30,
    async (): Promise<GrantResult> => {
      // Re-check in-lock: row já existe?
      const existing = await repo.getCustomerPackageByChargeId(orgId, chargeRow.id);
      if (existing) return { customerPackageId: existing.id, granted: false };

      // Guard: customer_id obrigatório.
      if (!chargeRow.customer_id) {
        await repo.insertChargeAudit({
          organizationId: orgId,
          chargeId: chargeRow.id,
          action: "charge.package_grant_skipped",
          actorType: "system",
          afterJson: { reason: "missing_customer_id" },
        });
        return { customerPackageId: "", granted: false };
      }

      // Guard: service_package_id no metadata (UUID-shape strict, fail-closed
      // antes do SELECT — distingue 'missing/malformed' de 'not_found' nos audits).
      const md = chargeRow.metadata as { service_package_id?: unknown } | null;
      const spid = md?.service_package_id;
      const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (typeof spid !== "string" || spid.length === 0 || !UUID_RE.test(spid)) {
        await repo.insertChargeAudit({
          organizationId: orgId,
          chargeId: chargeRow.id,
          action: "charge.package_grant_skipped",
          actorType: "system",
          afterJson: { reason: "missing_service_package_id" },
        });
        return { customerPackageId: "", granted: false };
      }

      // Guard: ServicePackage existe + active org-scoped.
      const sp = await repo.getServicePackageById(orgId, spid);
      if (!sp || !sp.is_active) {
        await repo.insertChargeAudit({
          organizationId: orgId,
          chargeId: chargeRow.id,
          action: "charge.package_grant_skipped",
          actorType: "system",
          afterJson: { reason: "service_package_not_found_or_inactive", service_package_id: spid },
        });
        return { customerPackageId: "", granted: false };
      }

      // Compute o grant via núcleo puro. paid_at é pré-condição (validity_days set).
      let grant;
      try {
        grant = buildCustomerPackageFromGrant({
          servicePackage: sp,
          charge: {
            id: chargeRow.id,
            organization_id: chargeRow.organization_id,
            customer_id: chargeRow.customer_id,
            paid_at: chargeRow.paid_at,
          },
        });
      } catch (err) {
        await repo.insertChargeAudit({
          organizationId: orgId,
          chargeId: chargeRow.id,
          action: "charge.package_grant_skipped",
          actorType: "system",
          afterJson: {
            reason: "build_grant_failed",
            error: err instanceof Error ? err.message : String(err),
          },
        });
        return { customerPackageId: "", granted: false };
      }

      // Insert idempotente schema-enforced (UNIQUE partial).
      const out = await repo.insertCustomerPackage({
        organizationId: grant.organization_id,
        customerId: grant.customer_id,
        servicePackageId: grant.service_package_id,
        chargeId: grant.charge_id,
        sessionsTotal: grant.sessions_total,
        sessionsUsed: grant.sessions_used,
        sessionsRemaining: grant.sessions_remaining,
        validUntil: grant.valid_until,
      });
      if (out.alreadyGranted) {
        return { customerPackageId: out.id, granted: false };
      }
      await repo.insertPackageAudit({
        organizationId: orgId,
        customerPackageId: out.id,
        action: "package.granted",
        actorType: "system",
        afterJson: {
          service_package_id: sp.id,
          sessions_total: grant.sessions_total,
          valid_until: grant.valid_until,
          charge_id: chargeRow.id,
          customer_id: chargeRow.customer_id,
        },
      });
      return { customerPackageId: out.id, granted: true };
    },
  );

  if (!result) {
    // Lock contention: audit + return granted=false (webhook 200; Stripe reentrega).
    await repo.insertChargeAudit({
      organizationId: orgId,
      chargeId: chargeRow.id,
      action: "charge.package_grant_skipped",
      actorType: "system",
      afterJson: { reason: "lock_contention" },
    });
    return { customerPackageId: "", granted: false };
  }
  return result;
}

export type DecrementOutcome =
  | "decremented"
  | "skipped_not_found"
  | "skipped_inactive"
  | "skipped_expired"
  | "skipped_exhausted"
  | "skipped_lock"
  | "failed";

export interface DecrementResult {
  outcome: DecrementOutcome;
  // M5-P2a Item 6 (T3): sessions_remaining é integer post-migration 0015.
  sessionsRemaining?: number;
  status?: string;
}

/**
 * Decrementa CustomerPackage para um appointment completed. Best-effort:
 * NUNCA propaga erro (mirror P2 prepayment hook). Lock por-pacote serializa
 * dois transitionAppointment(completed) concorrentes no mesmo pacote.
 */
export async function decrementCustomerPackageForAppointment(
  orgId: string,
  appointmentId: string,
  customerPackageId: string,
): Promise<DecrementResult> {
  const nowIsoDate = toIsoDate(new Date());
  const result = await withRedisLock(
    `payments:decrement-package:${customerPackageId}`,
    15,
    async (): Promise<DecrementResult> => {
      const pkg = await repo.getCustomerPackageById(orgId, customerPackageId);
      if (!pkg) {
        // Sem row de customer_package — usar insertChargeAudit como fallback.
        // audit_events.entity_id NÃO tem FK (text-free, sem CHECK), então
        // insertPackageAudit gravaria normalmente; a escolha é semântica
        // (não emitir audit row apontando para customer_package_id que não
        // resolve — confunde dashboards/grep). Audit fica sob entity_type
        // 'charge' como evento administrativo do flow de pacote.
        await repo.insertChargeAudit({
          organizationId: orgId,
          chargeId: customerPackageId,
          action: "charge.package_grant_skipped",
          actorType: "system",
          afterJson: {
            reason: "decrement_pkg_not_found",
            customer_package_id: customerPackageId,
            appointment_id: appointmentId,
          },
        });
        return { outcome: "skipped_not_found" };
      }
      const check = canDecrement(pkg, nowIsoDate);
      if (!check.ok) {
        if (check.reason === "inactive") {
          await repo.insertPackageAudit({
            organizationId: orgId,
            customerPackageId,
            action: "package.decrement_skipped",
            actorType: "system",
            afterJson: {
              reason: "inactive",
              status: pkg.status,
              appointment_id: appointmentId,
            },
          });
          return { outcome: "skipped_inactive", status: pkg.status };
        }
        if (check.reason === "expired") {
          await repo.expireOneCustomerPackage(orgId, customerPackageId);
          await repo.insertPackageAudit({
            organizationId: orgId,
            customerPackageId,
            action: "package.expired_at_decrement",
            actorType: "system",
            afterJson: {
              reason: "valid_until_past",
              appointment_id: appointmentId,
              valid_until: pkg.valid_until,
            },
          });
          return { outcome: "skipped_expired" };
        }
        // exhausted
        await repo.insertPackageAudit({
          organizationId: orgId,
          customerPackageId,
          action: "package.decrement_skipped",
          actorType: "system",
          afterJson: { reason: "exhausted", appointment_id: appointmentId },
        });
        return { outcome: "skipped_exhausted" };
      }
      try {
        const dec = await repo.decrementCustomerPackage(orgId, customerPackageId);
        if (!dec.decremented) {
          await repo.insertPackageAudit({
            organizationId: orgId,
            customerPackageId,
            action: "package.decrement_skipped",
            actorType: "system",
            afterJson: { reason: "race_lost", appointment_id: appointmentId },
          });
          return { outcome: "skipped_exhausted" };
        }
        await repo.insertPackageAudit({
          organizationId: orgId,
          customerPackageId,
          action: "package.session_decremented",
          actorType: "system",
          afterJson: {
            appointment_id: appointmentId,
            sessions_remaining: dec.sessionsRemaining,
            status: dec.status,
            transition_to_exhausted: dec.status === "exhausted",
          },
        });
        return {
          outcome: "decremented",
          sessionsRemaining: dec.sessionsRemaining,
          status: dec.status,
        };
      } catch (err) {
        await repo.insertPackageAudit({
          organizationId: orgId,
          customerPackageId,
          action: "package.decrement_failed",
          actorType: "system",
          afterJson: {
            appointment_id: appointmentId,
            error: err instanceof Error ? err.message : String(err),
          },
        });
        return { outcome: "failed" };
      }
    },
  );
  if (!result) {
    await repo.insertPackageAudit({
      organizationId: orgId,
      customerPackageId,
      action: "package.decrement_skipped",
      actorType: "system",
      afterJson: { reason: "lock_contention", appointment_id: appointmentId },
    });
    return { outcome: "skipped_lock" };
  }
  return result;
}
