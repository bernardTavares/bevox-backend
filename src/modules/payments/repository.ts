/**
 * Payments — todo acesso a DB. SQL parametrizado (sem import estático de
 * @/db/schema). get-or-create idempotente (índice payment_accounts_org_uniq
 * resolve corrida; 23505 → re-SELECT, precedente booking). Audit espelha
 * insertWaitlistAudit de C3 (entity_type='payment_account', actor_type
 * 'system'|'user', execution_id NULL). stripe_webhook_events dedupe via
 * ON CONFLICT DO NOTHING.
 */
import { sql } from "drizzle-orm";

import { getDb } from "@/db/client.js";
import { cacheAside, cacheInvalidate } from "@/lib/cache.js";
import { uuidv7 } from "@/shared/uuid.js";

const PAYMENT_ACCOUNT_CACHE_NAMESPACE = "payment-account-by-org";
const PAYMENT_ACCOUNT_CACHE_TTL_SECONDS = 60;

/**
 * tx-wrap helper (M5-P2a Item 4). Derives Tx type from Drizzle transaction
 * callback parameter so callers don't depend on private Drizzle internals.
 * DbOrTx union lets repository fns accept either getDb() or a tx handle —
 * default behavior preserved when omitted (legacy non-tx callers).
 *
 * Spec: docs/superpowers/specs/2026-05-21-backend-m5-p2-tech-debt-design.md §4.1
 */
type Db = ReturnType<typeof getDb>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export type DbOrTx = Db | Tx;

export async function withPaymentTx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return getDb().transaction(async (tx) => fn(tx));
}

export interface PaymentAccountRow {
  id: string;
  organization_id: string;
  account_holder_type: string;
  external_account_id: string | null;
  onboarding_status: string;
  charges_enabled: boolean;
  payouts_enabled: boolean;
  details_submitted: boolean;
}

export interface OnboardingSnapshot {
  onboarding_status: string;
  charges_enabled: boolean;
  payouts_enabled: boolean;
  details_submitted: boolean;
}

/** Pure: houve mudança real (status OU qualquer boolean de diagnóstico). */
export function onboardingChanged(before: OnboardingSnapshot, after: OnboardingSnapshot): boolean {
  return (
    before.onboarding_status !== after.onboarding_status ||
    before.charges_enabled !== after.charges_enabled ||
    before.payouts_enabled !== after.payouts_enabled ||
    before.details_submitted !== after.details_submitted
  );
}

function isOrgUniqViolation(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const e = err as { code?: unknown; constraint?: unknown };
  return (
    e.code === "23505" &&
    (e.constraint === undefined || e.constraint === "payment_accounts_org_uniq")
  );
}

export async function getByOrg(orgId: string): Promise<PaymentAccountRow | null> {
  return (await cacheAside(orgId, {
    namespace: PAYMENT_ACCOUNT_CACHE_NAMESPACE,
    ttlSeconds: PAYMENT_ACCOUNT_CACHE_TTL_SECONDS,
    fetch: async () => {
      const r = await getDb().execute(sql`
        SELECT id, organization_id, account_holder_type, external_account_id,
               onboarding_status, charges_enabled, payouts_enabled, details_submitted
        FROM payment_accounts
        WHERE organization_id = ${orgId} AND account_holder_type = 'organization'
        LIMIT 1`);
      return (r.rows[0] as PaymentAccountRow | undefined) ?? null;
    },
  })) as PaymentAccountRow | null;
}

/** Resolve a conta manual ativa da org (provider='manual'), ou null. */
export async function getManualAccount(orgId: string): Promise<PaymentAccountRow | null> {
  const r = await getDb().execute(sql`
    SELECT id, organization_id, account_holder_type, external_account_id,
           onboarding_status, charges_enabled, payouts_enabled, details_submitted
    FROM payment_accounts
    WHERE organization_id = ${orgId} AND provider = 'manual'
      AND account_holder_type = 'organization' LIMIT 1`);
  return (r.rows[0] as PaymentAccountRow | undefined) ?? null;
}

/**
 * Cria (ou retorna existente) a conta manual ativa da org. Idempotente
 * (M5-P4 Task 10 onboarding). provider='manual' → ativa imediatamente, sem
 * Stripe Connect / KYC: charges_enabled=true, payouts_enabled=false (Bevox
 * não move dinheiro no modo manual), details_submitted=true, onboarding_status
 * 'active'. SELECT-guard por getManualAccount; INSERT idempotente
 * (ON CONFLICT DO NOTHING contra payment_accounts_org_uniq, par com o
 * idiom de getOrCreateLocalAccount). id explícito uuidv7() (mesmo pattern).
 */
export async function createManualAccount(orgId: string): Promise<PaymentAccountRow> {
  const existing = await getManualAccount(orgId);
  if (existing) return existing;
  await getDb().execute(sql`
    INSERT INTO payment_accounts
      (id, organization_id, provider, account_holder_type, onboarding_status,
       charges_enabled, payouts_enabled, details_submitted)
    VALUES (${uuidv7()}, ${orgId}, 'manual', 'organization', 'active', true, false, true)
    ON CONFLICT DO NOTHING`);
  const row = await getManualAccount(orgId);
  if (!row) {
    // org já possui uma conta org-level de outro provider (ex.: stripe) — a
    // partial-unique payment_accounts_org_uniq (account_holder_type=
    // 'organization') só permite UMA conta org-level. Coexistência
    // cross-provider org-level está FORA DE ESCOPO V1; erro claro.
    throw new Error("organization already has a non-manual org-level payment account");
  }
  return row;
}

/** True se a payment_account org-level está mais velha que `staleMin` (reconcile-on-read gate). */
export async function isStale(orgId: string, staleMin: number): Promise<boolean> {
  const r = await getDb().execute(sql`
    SELECT (updated_at < now() - (${staleMin} || ' minutes')::interval) AS stale
    FROM payment_accounts
    WHERE organization_id = ${orgId} AND account_holder_type = 'organization'
    LIMIT 1`);
  return (r.rows[0] as { stale: boolean } | undefined)?.stale === true;
}

export async function getByExternalId(
  externalAccountId: string,
): Promise<PaymentAccountRow | null> {
  const r = await getDb().execute(sql`
    SELECT id, organization_id, account_holder_type, external_account_id,
           onboarding_status, charges_enabled, payouts_enabled, details_submitted
    FROM payment_accounts WHERE external_account_id = ${externalAccountId} LIMIT 1`);
  return (r.rows[0] as PaymentAccountRow | undefined) ?? null;
}

/** Get-or-create org-level local row. Idempotente sob corrida (23505→re-SELECT). */
export async function getOrCreateLocalAccount(orgId: string): Promise<PaymentAccountRow> {
  const existing = await getByOrg(orgId);
  if (existing) return existing;
  try {
    await getDb().execute(sql`
      INSERT INTO payment_accounts (id, organization_id, account_holder_type, provider, onboarding_status)
      VALUES (${uuidv7()}, ${orgId}, 'organization', 'stripe', 'pending')`);
  } catch (err) {
    if (!isOrgUniqViolation(err)) throw err;
  }
  // INSERT path muta o shape cacheado por getByOrg → invalidate antes do
  // re-SELECT garante leitura DB autoritativa pós-create (par mutate-then-
  // invalidate, mesmo idiom do org repo P2).
  await cacheInvalidate(PAYMENT_ACCOUNT_CACHE_NAMESPACE, orgId);
  const row = await getByOrg(orgId);
  if (!row) throw new Error("payment_accounts get-or-create falhou (pós-INSERT sem linha)");
  return row;
}

/**
 * UPDATE external_account_id. orgId recebido pelo caller (não derivável da
 * row sem extra round-trip) para pair mutate → cacheInvalidate. Signature
 * mudou em M5-P1 hot-path #2: callers atualizados em service.ts (lock-flow
 * connectPaymentAccount tem orgId no scope).
 */
export async function setExternalAccountId(
  orgId: string,
  paymentAccountId: string,
  externalAccountId: string,
): Promise<void> {
  await getDb().execute(sql`
    UPDATE payment_accounts SET external_account_id = ${externalAccountId}, updated_at = now()
    WHERE id = ${paymentAccountId}`);
  await cacheInvalidate(PAYMENT_ACCOUNT_CACHE_NAMESPACE, orgId);
}

/**
 * UPDATE guardado do estado de onboarding. Idempotente. orgId recebido pelo
 * caller para pair mutate → cacheInvalidate; signature mudou em M5-P1
 * hot-path #2 (callers em service.reconcileFromStripe + webhook.account.updated
 * têm orgId no scope via row já lida).
 *
 * M5-P2a Item 4: aceita optional dbOrTx (default getDb()) para atomic-
 * tx pair com insertPaymentAudit em service.ts:129-130 + webhook.ts:87-88.
 * cacheInvalidate é Redis (não DB) → roda fora do tx por design; fail-open
 * não bloqueia COMMIT.
 */
export async function updateOnboardingState(
  orgId: string,
  paymentAccountId: string,
  s: OnboardingSnapshot,
  dbOrTx?: DbOrTx,
): Promise<void> {
  const exec = dbOrTx ?? getDb();
  await exec.execute(sql`
    UPDATE payment_accounts
    SET onboarding_status = ${s.onboarding_status},
        charges_enabled = ${s.charges_enabled},
        payouts_enabled = ${s.payouts_enabled},
        details_submitted = ${s.details_submitted},
        updated_at = now()
    WHERE id = ${paymentAccountId}`);
  await cacheInvalidate(PAYMENT_ACCOUNT_CACHE_NAMESPACE, orgId);
}

/**
 * M5-P2a Item 4: aceita optional dbOrTx (default getDb()) para atomic-tx
 * pair com updateOnboardingState. Sem tx → comportamento legacy.
 */
export async function insertPaymentAudit(
  input: {
    organizationId: string;
    paymentAccountId: string;
    action: string;
    actorType: "system" | "user";
    actorId?: string; // P3a: actor uuid (resolvido clerk→users.id); omit → NULL (byte-idêntico aos callers system pré-P3a)
    afterJson: Record<string, unknown>;
  },
  dbOrTx?: DbOrTx,
): Promise<void> {
  const exec = dbOrTx ?? getDb();
  await exec.execute(sql`
    INSERT INTO audit_events
      (organization_id, entity_type, entity_id, action, actor_type, actor_id,
       reason_text, execution_id, after_json)
    VALUES (${input.organizationId}, 'payment_account', ${input.paymentAccountId},
            ${input.action}, ${input.actorType}, ${input.actorId ?? null}, NULL, NULL,
            ${JSON.stringify(input.afterJson)}::jsonb)`);
}

/**
 * Insere o evento (dedupe por stripe_event_id). ON CONFLICT faz UPDATE no-op
 * para que RETURNING sempre devolva a linha — incluindo o caso "gravado mas
 * processamento anterior falhou antes de markWebhookProcessed". Decisão de
 * reprocessamento fica com o caller via `alreadyProcessed`:
 *  - false → ainda não concluído; o caller reprocessa (Stripe reentrega em
 *    backoff sequencial; o processamento de account.updated é idempotente).
 *  - true  → duplicado genuíno já concluído → 200 sem reprocessar.
 * Stripe não entrega o mesmo event_id concorrentemente (retries são
 * sequenciais), então o upsert de uma só statement basta — sem janela de
 * lost-update que existia com DO NOTHING + RETURNING vazio.
 */
export async function recordWebhookEvent(input: {
  organizationId: string | null;
  stripeEventId: string;
  type: string;
}): Promise<{ id: string; alreadyProcessed: boolean }> {
  const r = await getDb().execute(sql`
    INSERT INTO stripe_webhook_events (id, organization_id, stripe_event_id, type)
    VALUES (${uuidv7()}, ${input.organizationId}, ${input.stripeEventId}, ${input.type})
    ON CONFLICT (stripe_event_id) DO UPDATE SET stripe_event_id = EXCLUDED.stripe_event_id
    RETURNING id, processed_at`);
  const row = r.rows[0] as { id: string; processed_at: Date | string | null };
  return { id: row.id, alreadyProcessed: row.processed_at !== null };
}

export async function markWebhookProcessed(id: string): Promise<void> {
  await getDb().execute(sql`
    UPDATE stripe_webhook_events SET processed_at = now() WHERE id = ${id}`);
}

export interface ChargeRow {
  id: string;
  organization_id: string;
  customer_id: string | null;
  appointment_id: string | null;
  service_id: string | null;
  professional_id: string | null;
  payment_account_id: string;
  charge_type: string;
  status: string;
  amount_total: string;
  amount_platform_fee: string | null;
  currency: string;
  provider_charge_id: string | null;
  payment_method: string | null;
  expires_at: Date | string | null;
  paid_at: Date | string | null;
  metadata: Record<string, unknown> | null;
}

function isChargeIdemViolation(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const e = err as { code?: unknown; constraint?: unknown };
  return (
    e.code === "23505" &&
    (e.constraint === undefined || e.constraint === "charges_org_idempotency_uniq")
  );
}

const CHARGE_COLS = sql`id, organization_id, customer_id, appointment_id, service_id,
  professional_id, payment_account_id, charge_type, status, amount_total,
  amount_platform_fee, currency, provider_charge_id, payment_method, expires_at, paid_at, metadata`;

/**
 * INSERT charge `pending` idempotente. Unique (organization_id,
 * idempotency_key) → 23505 ⇒ re-SELECT a charge existente (precedente
 * booking isIdempotencyUniqueViolation): exactly-one-charge.
 *
 * CONTRATO (caminho de dinheiro): o re-SELECT pode devolver uma charge
 * cujo `provider_charge_id` ainda é NULL (request A inseriu mas ainda não
 * chamou setChargeProvider). O caller NÃO pode cegamente criar um
 * PaymentIntent novo nesse caso — sob retry isso orfanaria o PI anterior.
 * O caller (service.createCharge) DEVE: (a) reusar `provider_charge_id` se
 * já setado; (b) criar o PI sob `withRedisLock("payments:charge:"+id)` com
 * re-check in-lock; (c) passar Stripe `idempotencyKey: charge:${id}`
 * (ADR-023 Stripe-side). Essa tripla defesa fecha a janela cross-call;
 * a camada de repositório sozinha garante só exactly-one-charge-row.
 */
export async function insertChargePending(input: {
  organizationId: string;
  customerId: string;
  appointmentId: string | null;
  serviceId: string | null;
  professionalId: string | null;
  paymentAccountId: string;
  // string decimal (ex. "120.50") — money decimal-safe p/ numeric(10,2),
  // sem round-trip por float binário JS (charge-flow audit I3).
  amountTotal: string;
  amountPlatformFee: string | null;
  currency: string;
  idempotencyKey: string;
  chargeType: "full" | "package";
  paymentMethod: string | null;
  metadata: Record<string, unknown> | null;
}): Promise<{ id: string }> {
  const id = uuidv7();
  try {
    await getDb().execute(sql`
      INSERT INTO charges
        (id, organization_id, customer_id, appointment_id, service_id,
         professional_id, payment_account_id, charge_type, status,
         amount_total, amount_platform_fee, currency, payment_method, idempotency_key, metadata)
      VALUES (${id}, ${input.organizationId}, ${input.customerId}, ${input.appointmentId},
              ${input.serviceId}, ${input.professionalId}, ${input.paymentAccountId},
              ${input.chargeType}, 'pending', ${input.amountTotal}, ${input.amountPlatformFee},
              ${input.currency}, ${input.paymentMethod}, ${input.idempotencyKey},
              ${input.metadata === null ? null : JSON.stringify(input.metadata)}::jsonb)`);
    return { id };
  } catch (err) {
    if (!isChargeIdemViolation(err)) throw err;
    const r = await getDb().execute(sql`
      SELECT id FROM charges
      WHERE organization_id = ${input.organizationId}
        AND idempotency_key = ${input.idempotencyKey} LIMIT 1`);
    const row = r.rows[0] as { id: string } | undefined;
    if (!row) throw err;
    return { id: row.id };
  }
}

/**
 * Grava provider_charge_id (= PaymentIntent id) + expires_at (da resposta
 * Stripe). expiresAt pode ser null se o display Stripe vier anômalo — o
 * provider_charge_id é persistido mesmo assim (orphan-avoidance: o webhook
 * platform precisa resolver a charge por provider_charge_id).
 */
export async function setChargeProvider(
  chargeId: string,
  providerChargeId: string,
  expiresAt: Date | null,
): Promise<void> {
  await getDb().execute(sql`
    UPDATE charges
    SET provider_charge_id = ${providerChargeId}, expires_at = ${expiresAt}, updated_at = now()
    WHERE id = ${chargeId}`);
}

export async function getChargeById(orgId: string, chargeId: string): Promise<ChargeRow | null> {
  const r = await getDb().execute(sql`
    SELECT ${CHARGE_COLS} FROM charges
    WHERE id = ${chargeId} AND organization_id = ${orgId} LIMIT 1`);
  return (r.rows[0] as ChargeRow | undefined) ?? null;
}

export async function getChargeByProviderId(providerChargeId: string): Promise<ChargeRow | null> {
  const r = await getDb().execute(sql`
    SELECT ${CHARGE_COLS} FROM charges
    WHERE provider_charge_id = ${providerChargeId} LIMIT 1`);
  return (r.rows[0] as ChargeRow | undefined) ?? null;
}

/**
 * Transição guardada pending→paid (idempotente). Org-scoped por construção
 * (charge-flow audit M1): tenant-safe mesmo se um caller futuro esquecer o
 * pré-check — um par (org, charge) inconsistente UPDATE 0 linhas.
 */
export async function markChargePaid(orgId: string, chargeId: string, paidAt: Date): Promise<void> {
  await getDb().execute(sql`
    UPDATE charges SET status = 'paid', paid_at = ${paidAt}, updated_at = now()
    WHERE id = ${chargeId} AND organization_id = ${orgId} AND status = 'pending'`);
}

/** Transição guardada → refunded (idempotente; só de paid; org-scoped). */
export async function markChargeRefunded(orgId: string, chargeId: string): Promise<void> {
  await getDb().execute(sql`
    UPDATE charges SET status = 'refunded', updated_at = now()
    WHERE id = ${chargeId} AND organization_id = ${orgId} AND status = 'paid'`);
}

/** Transição guardada pending→expired (idempotente; só de pending; org-scoped). */
export async function markChargeExpired(orgId: string, chargeId: string): Promise<void> {
  await getDb().execute(sql`
    UPDATE charges SET status = 'expired', updated_at = now()
    WHERE id = ${chargeId} AND organization_id = ${orgId} AND status = 'pending'`);
}

/**
 * INSERT payment com dedupe por (organization_id, provider_payment_id, status)
 * via ON CONFLICT DO NOTHING — apoiado pelo UNIQUE
 * `payments_org_provider_status_uniq` (migration 0016). Race-safe: substitui o
 * antigo SELECT-guard, mantendo o contrato silent-dedupe (não lança em
 * conflito → preserva o 200-always do webhook Stripe).
 */
export async function insertPayment(input: {
  organizationId: string;
  chargeId: string;
  status: "paid" | "failed" | "reversed";
  providerPaymentId: string;
  amountPaid: number;
  currency: string;
  paidAt: Date | null;
  rawPayloadJson: Record<string, unknown>;
}): Promise<void> {
  await getDb().execute(sql`
    INSERT INTO payments
      (id, organization_id, charge_id, status, provider_payment_id,
       amount_paid, currency, paid_at, raw_payload_json)
    VALUES (${uuidv7()}, ${input.organizationId}, ${input.chargeId}, ${input.status},
            ${input.providerPaymentId}, ${input.amountPaid}, ${input.currency},
            ${input.paidAt}, ${JSON.stringify(input.rawPayloadJson)}::jsonb)
    ON CONFLICT (organization_id, provider_payment_id, status) DO NOTHING`);
}

/**
 * INSERT refund com dedupe atômico por (organization_id, provider_refund_id)
 * via ON CONFLICT DO NOTHING — apoiado pelo UNIQUE parcial
 * `refunds_org_provider_refund_uniq` (migration 0017). Race-safe: substitui o
 * antigo SELECT-then-INSERT, fechando o double-count sob TTL-overrun do
 * Redis-lock (C1). O conflict_target replica o predicado parcial
 * (`WHERE provider_refund_id IS NOT NULL`) exigido pelo Postgres p/ casar o
 * índice parcial.
 */
export async function recordRefund(input: {
  organizationId: string;
  chargeId: string;
  status: "pending" | "succeeded" | "failed";
  amount: number;
  providerRefundId: string;
  idempotencyKey?: string; // P3b: dedup determinístico do caminho Stripe (manual/webhook passam undefined → NULL)
}): Promise<void> {
  await getDb().execute(sql`
    INSERT INTO refunds
      (id, organization_id, charge_id, status, amount, provider_refund_id, idempotency_key)
    VALUES (${uuidv7()}, ${input.organizationId}, ${input.chargeId},
            ${input.status}, ${input.amount}, ${input.providerRefundId}, ${input.idempotencyKey ?? null})
    ON CONFLICT (organization_id, provider_refund_id) WHERE provider_refund_id IS NOT NULL DO NOTHING`);
}

/**
 * Transição só-forward de refunds.status (pending → succeeded ou failed),
 * idempotente. O WHERE status='pending' garante que nunca regride nem toca
 * uma row já terminal — o webhook pode reentregar refund.updated/.failed
 * fora de ordem sem corromper o ledger. Sem updated_at (canon §11.4 não
 * tem; postura de payments). Zero-migration. Retorna true sse a row foi
 * de fato transicionada (RETURNING) — o caller usa isto p/ não auditar
 * uma falha que nunca aconteceu (refund já terminal).
 */
export async function updateRefundStatus(
  providerRefundId: string,
  status: "succeeded" | "failed",
): Promise<boolean> {
  const r = await getDb().execute(sql`
    UPDATE refunds SET status = ${status}
    WHERE provider_refund_id = ${providerRefundId} AND status = 'pending'
    RETURNING id`);
  return (r.rows?.length ?? 0) > 0;
}

export interface RefundRow {
  id: string;
  organization_id: string;
  charge_id: string;
  status: string;
  amount: string;
  provider_refund_id: string | null;
}

/**
 * Lê a refund row por provider_refund_id, org-scoped (mesma postura
 * org-scoped do dedupe de recordRefund). O webhook usa a status PERSISTIDA
 * autoritativa — não o payload do evento — para decidir a transição
 * charge→refunded / payment→reversed (uma reentrega/ordem-invertida não
 * pode marcar charge refunded enquanto refunds.status=failed).
 */
export async function getRefundByProviderId(
  orgId: string,
  providerRefundId: string,
): Promise<RefundRow | null> {
  const r = await getDb().execute(sql`
    SELECT id, organization_id, charge_id, status, amount, provider_refund_id
    FROM refunds
    WHERE provider_refund_id = ${providerRefundId} AND organization_id = ${orgId}
    LIMIT 1`);
  return (r.rows[0] as RefundRow | undefined) ?? null;
}

/**
 * Lê a refund row por idempotency_key (input), org+charge-scoped. P3b: o caminho
 * Stripe não tem provider_refund_id determinístico pré-call (é o rf.id do Stripe),
 * então o `!already`-check do guard de over-refund usa o input idempotency_key.
 */
export async function getRefundByIdempotencyKey(
  orgId: string,
  chargeId: string,
  idempotencyKey: string,
): Promise<RefundRow | null> {
  const r = await getDb().execute(sql`
    SELECT id, organization_id, charge_id, status, amount, provider_refund_id
    FROM refunds
    WHERE organization_id = ${orgId} AND charge_id = ${chargeId}
      AND idempotency_key = ${idempotencyKey}
    LIMIT 1`);
  return (r.rows[0] as RefundRow | undefined) ?? null;
}

/**
 * Soma (em CENTAVOS inteiros) os refunds 'succeeded' de uma charge, org-scoped.
 * Consumido por applyChargeRefunded p/ decidir full-vs-partial cumulativo
 * (dois parciais que somam o total = full). Comparação em cents casa com
 * isFullRefund (Math.round(amount*100)) — sem float drift.
 */
export async function sumSucceededRefundsCents(orgId: string, chargeId: string): Promise<number> {
  const r = await getDb().execute(sql`
    SELECT COALESCE(SUM(amount), 0) AS total FROM refunds
    WHERE organization_id = ${orgId} AND charge_id = ${chargeId} AND status = 'succeeded'`);
  const total = (r.rows[0] as { total: string | number } | undefined)?.total ?? 0;
  return Math.round(Number(total) * 100);
}

/**
 * Soma (CENTAVOS) refunds NÃO-failed (pending+succeeded) de uma charge, org-scoped.
 * P3b: o guard de over-refund do caminho Stripe conta pending também (um parcial
 * Stripe pode ficar `pending` antes do webhook → não pode escapar do guard). O
 * manual usa sumSucceededRefundsCents (grava 'succeeded' síncrono).
 */
export async function sumNonFailedRefundsCents(orgId: string, chargeId: string): Promise<number> {
  const r = await getDb().execute(sql`
    SELECT COALESCE(SUM(amount), 0) AS total FROM refunds
    WHERE organization_id = ${orgId} AND charge_id = ${chargeId} AND status <> 'failed'`);
  const total = (r.rows[0] as { total: string | number } | undefined)?.total ?? 0;
  return Math.round(Number(total) * 100);
}

// ============================================================================
// Packages P4 — ServicePackage + CustomerPackage (canon §11.5/§11.6).
// ============================================================================

export interface ServicePackageRow {
  id: string;
  organization_id: string;
  name: string;
  service_id: string | null;
  // M5-P2a Item 6 (T3): post-migration 0015 sessions_included é integer
  // → pg text-protocol retorna como JS number.
  sessions_included: number;
  price_amount: string;
  validity_days: string | null;
  is_active: boolean;
  created_at: Date | string;
  updated_at: Date | string;
}

const SERVICE_PACKAGE_COLS = sql`id, organization_id, name, service_id,
  sessions_included, price_amount, validity_days, is_active, created_at, updated_at`;

export async function insertServicePackage(input: {
  organizationId: string;
  name: string;
  serviceId: string | null;
  sessionsIncluded: number;
  priceAmount: number;
  validityDays: number | null;
}): Promise<{ id: string }> {
  const id = uuidv7();
  // M5-P2a Item 6 (T3): sessions_included agora integer; bind direto como
  // number (sem String() coercion legada do decimal-string idiom).
  await getDb().execute(sql`
    INSERT INTO service_packages
      (id, organization_id, name, service_id, sessions_included, price_amount, validity_days, is_active)
    VALUES (${id}, ${input.organizationId}, ${input.name}, ${input.serviceId},
            ${input.sessionsIncluded}, ${input.priceAmount.toFixed(2)},
            ${input.validityDays === null ? null : String(input.validityDays)}, true)`);
  return { id };
}

export async function getServicePackageById(
  orgId: string,
  id: string,
): Promise<ServicePackageRow | null> {
  const r = await getDb().execute(sql`
    SELECT ${SERVICE_PACKAGE_COLS} FROM service_packages
    WHERE id = ${id} AND organization_id = ${orgId} LIMIT 1`);
  return (r.rows[0] as ServicePackageRow | undefined) ?? null;
}

export async function listServicePackages(
  orgId: string,
  opts?: { includeInactive?: boolean },
): Promise<ServicePackageRow[]> {
  const includeInactive = opts?.includeInactive === true;
  if (includeInactive) {
    const r = await getDb().execute(sql`
      SELECT ${SERVICE_PACKAGE_COLS} FROM service_packages
      WHERE organization_id = ${orgId}
      ORDER BY created_at DESC LIMIT 200`);
    return r.rows as unknown as ServicePackageRow[];
  }
  const r = await getDb().execute(sql`
    SELECT ${SERVICE_PACKAGE_COLS} FROM service_packages
    WHERE organization_id = ${orgId} AND is_active = true
    ORDER BY created_at DESC LIMIT 200`);
  return r.rows as unknown as ServicePackageRow[];
}

export interface CustomerPackageRow {
  id: string;
  organization_id: string;
  customer_id: string;
  service_package_id: string;
  charge_id: string | null;
  status: string;
  // M5-P2a Item 6 (T3): post-migration 0015 sessions_* são integer
  // → pg text-protocol retorna como JS number.
  sessions_total: number;
  sessions_used: number;
  sessions_remaining: number;
  valid_until: string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

const CUSTOMER_PACKAGE_COLS = sql`id, organization_id, customer_id, service_package_id,
  charge_id, status, sessions_total, sessions_used, sessions_remaining,
  valid_until, created_at, updated_at`;

export async function getCustomerPackageById(
  orgId: string,
  id: string,
): Promise<CustomerPackageRow | null> {
  const r = await getDb().execute(sql`
    SELECT ${CUSTOMER_PACKAGE_COLS} FROM customer_packages
    WHERE id = ${id} AND organization_id = ${orgId} LIMIT 1`);
  return (r.rows[0] as CustomerPackageRow | undefined) ?? null;
}

export async function getCustomerPackageByChargeId(
  orgId: string,
  chargeId: string,
): Promise<CustomerPackageRow | null> {
  const r = await getDb().execute(sql`
    SELECT ${CUSTOMER_PACKAGE_COLS} FROM customer_packages
    WHERE organization_id = ${orgId} AND charge_id = ${chargeId} LIMIT 1`);
  return (r.rows[0] as CustomerPackageRow | undefined) ?? null;
}

export async function listCustomerPackagesByCustomer(
  orgId: string,
  customerId: string,
  opts?: { includeTerminal?: boolean },
): Promise<CustomerPackageRow[]> {
  const includeTerminal = opts?.includeTerminal === true;
  if (includeTerminal) {
    const r = await getDb().execute(sql`
      SELECT ${CUSTOMER_PACKAGE_COLS} FROM customer_packages
      WHERE organization_id = ${orgId} AND customer_id = ${customerId}
      ORDER BY status = 'active' DESC, created_at DESC LIMIT 200`);
    return r.rows as unknown as CustomerPackageRow[];
  }
  const r = await getDb().execute(sql`
    SELECT ${CUSTOMER_PACKAGE_COLS} FROM customer_packages
    WHERE organization_id = ${orgId} AND customer_id = ${customerId} AND status = 'active'
    ORDER BY created_at DESC LIMIT 200`);
  return r.rows as unknown as CustomerPackageRow[];
}

function isCustomerPackageChargeUniqViolation(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const e = err as { code?: unknown; constraint?: unknown };
  return (
    e.code === "23505" &&
    (e.constraint === undefined || e.constraint === "customer_packages_charge_uniq")
  );
}

/**
 * Insert-once-by-charge (idempotent grant). SELECT-guard org-scoped por
 * (organization_id, charge_id) — se já existe, retorna existing.
 * Senão INSERT; tratamento de 23505 (UNIQUE partial customer_packages_charge_uniq)
 * → re-SELECT (defesa em par contra corrida intra-lock concorrente).
 */
export async function insertCustomerPackage(input: {
  organizationId: string;
  customerId: string;
  servicePackageId: string;
  chargeId: string;
  // M5-P2a Item 6 (T3): sessions_* agora integer (post-migration 0015).
  sessionsTotal: number;
  sessionsUsed: number;
  sessionsRemaining: number;
  validUntil: string | null;
}): Promise<{ id: string; alreadyGranted: boolean }> {
  const existing = await getCustomerPackageByChargeId(input.organizationId, input.chargeId);
  if (existing) return { id: existing.id, alreadyGranted: true };
  const id = uuidv7();
  try {
    await getDb().execute(sql`
      INSERT INTO customer_packages
        (id, organization_id, customer_id, service_package_id, charge_id, status,
         sessions_total, sessions_used, sessions_remaining, valid_until)
      VALUES (${id}, ${input.organizationId}, ${input.customerId},
              ${input.servicePackageId}, ${input.chargeId}, 'active',
              ${input.sessionsTotal}, ${input.sessionsUsed}, ${input.sessionsRemaining},
              ${input.validUntil})`);
    return { id, alreadyGranted: false };
  } catch (err) {
    if (!isCustomerPackageChargeUniqViolation(err)) throw err;
    const row = await getCustomerPackageByChargeId(input.organizationId, input.chargeId);
    if (!row) throw err;
    return { id: row.id, alreadyGranted: true };
  }
}

/**
 * Atomic decrement do CustomerPackage. RETURNING-backed. Idempotente sob
 * re-fire: WHERE status='active' + sessions_remaining>0 + (valid_until
 * IS NULL OR valid_until >= CURRENT_DATE) — 2ª execução não casa, no-op.
 * Quando o decrement leva sessions_remaining a 0, status transiciona a
 * 'exhausted' na mesma UPDATE (CASE referencia o OLD value, PG semantics).
 */
export async function decrementCustomerPackage(
  orgId: string,
  customerPackageId: string,
): Promise<{ decremented: boolean; status?: string; sessionsRemaining?: number }> {
  const r = await getDb().execute(sql`
    UPDATE customer_packages
    SET sessions_remaining = sessions_remaining - 1,
        sessions_used      = sessions_used + 1,
        status             = CASE WHEN sessions_remaining - 1 = 0 THEN 'exhausted' ELSE status END,
        updated_at         = now()
    WHERE id = ${customerPackageId}
      AND organization_id = ${orgId}
      AND status = 'active'
      AND sessions_remaining > 0
      AND (valid_until IS NULL OR valid_until >= CURRENT_DATE)
    RETURNING status, sessions_remaining`);
  if ((r.rows?.length ?? 0) === 0) {
    return { decremented: false };
  }
  // M5-P2a Item 6 (T3): sessions_remaining é integer post-migration 0015 →
  // pg text-protocol retorna number.
  const row = r.rows[0] as { status: string; sessions_remaining: number };
  return { decremented: true, status: row.status, sessionsRemaining: row.sessions_remaining };
}

/**
 * Cancela CustomerPackage por charge_id (chamado pelo webhook full-refund
 * branch quando charge_type='package'). Idempotente: 2ª execução com row
 * já 'cancelled' — no-op (WHERE status IN active/exhausted/expired).
 * sessions_used preserva histórico (serviço prestado não se desfaz).
 */
export async function cancelCustomerPackageByChargeId(
  orgId: string,
  chargeId: string,
): Promise<{ cancelled: boolean }> {
  const r = await getDb().execute(sql`
    UPDATE customer_packages
    SET status = 'cancelled', sessions_remaining = 0, updated_at = now()
    WHERE organization_id = ${orgId} AND charge_id = ${chargeId}
      AND status IN ('active','exhausted','expired')
    RETURNING id`);
  return { cancelled: (r.rows?.length ?? 0) > 0 };
}

/**
 * Cron-driven batch expiry. Cross-tenant maintenance op — apenas chamado
 * do worker BullMQ, NÃO de REST. Idempotente: WHERE status='active' guarda
 * que re-run não re-expira.
 */
export async function expireDuePackages(): Promise<{
  expiredIds: Array<{ id: string; organization_id: string }>;
}> {
  const r = await getDb().execute(sql`
    UPDATE customer_packages
    SET status = 'expired', sessions_remaining = 0, updated_at = now()
    WHERE status = 'active'
      AND valid_until IS NOT NULL
      AND valid_until < CURRENT_DATE
    RETURNING id, organization_id`);
  return {
    expiredIds: (r.rows ?? []) as Array<{ id: string; organization_id: string }>,
  };
}

/**
 * Org-scoped variante de expireDuePackages para o decrement-time guard
 * (fecha a janela cron-stale mid-day quando o service detecta valid_until
 * < CURRENT_DATE).
 */
export async function expireOneCustomerPackage(
  orgId: string,
  customerPackageId: string,
): Promise<{ expired: boolean }> {
  const r = await getDb().execute(sql`
    UPDATE customer_packages
    SET status = 'expired', sessions_remaining = 0, updated_at = now()
    WHERE id = ${customerPackageId} AND organization_id = ${orgId}
      AND status = 'active'
      AND valid_until IS NOT NULL
      AND valid_until < CURRENT_DATE
    RETURNING id`);
  return { expired: (r.rows?.length ?? 0) > 0 };
}

/**
 * Lê o flag `no_show_consumes_session` org-scoped do JSONB
 * `payment_accounts.split_config_json` (canon-autorizado container —
 * mesmo idiom de `split_config_json.platform_fee_percent` P2). Default
 * false se row ausente / JSONB null / chave ausente / não-boolean
 * (fail-closed canon-literal). Sem coluna nova em payment_accounts.
 */
export async function getPaymentAccountNoShowFlag(orgId: string): Promise<boolean> {
  const r = await getDb().execute(sql`
    SELECT COALESCE(
      CASE LOWER(split_config_json->>'no_show_consumes_session')
        WHEN 'true' THEN true
        WHEN 't' THEN true
        WHEN '1' THEN true
        WHEN 'false' THEN false
        WHEN 'f' THEN false
        WHEN '0' THEN false
        ELSE NULL
      END,
      false
    ) AS no_show_flag
    FROM payment_accounts
    WHERE organization_id = ${orgId} AND account_holder_type = 'organization'
    LIMIT 1`);
  const row = r.rows[0] as { no_show_flag: boolean } | undefined;
  return row?.no_show_flag === true;
}

/**
 * Audit dedicado p/ ServicePackage. entity_type='service_package'
 * (text livre em audit_events, sem CHECK, zero-migration adicional).
 */
export async function insertServicePackageAudit(input: {
  organizationId: string;
  servicePackageId: string;
  action: string;
  actorType: "system" | "user";
  afterJson: Record<string, unknown>;
}): Promise<void> {
  await getDb().execute(sql`
    INSERT INTO audit_events
      (organization_id, entity_type, entity_id, action, actor_type, actor_id,
       reason_text, execution_id, after_json)
    VALUES (${input.organizationId}, 'service_package', ${input.servicePackageId},
            ${input.action}, ${input.actorType}, NULL, NULL, NULL,
            ${JSON.stringify(input.afterJson)}::jsonb)`);
}

/**
 * Audit dedicado p/ CustomerPackage. entity_type='customer_package'.
 * NÃO inclui 'grant_skipped' — esse evento ocorre quando a row de
 * customer_package NÃO foi criada (sem id válido); registrado via
 * insertChargeAudit action='charge.package_grant_skipped' (mirror P2
 * 'charge.hook_skipped').
 */
export async function insertPackageAudit(input: {
  organizationId: string;
  customerPackageId: string;
  action:
    | "package.granted"
    | "package.session_decremented"
    | "package.decrement_skipped"
    | "package.decrement_failed"
    | "package.cancelled"
    | "package.expired_by_cron"
    | "package.expired_at_decrement";
  actorType: "system" | "user";
  afterJson: Record<string, unknown>;
}): Promise<void> {
  await getDb().execute(sql`
    INSERT INTO audit_events
      (organization_id, entity_type, entity_id, action, actor_type, actor_id,
       reason_text, execution_id, after_json)
    VALUES (${input.organizationId}, 'customer_package', ${input.customerPackageId},
            ${input.action}, ${input.actorType}, NULL, NULL, NULL,
            ${JSON.stringify(input.afterJson)}::jsonb)`);
}

/**
 * Transição guardada do payment para 'reversed' (só de 'paid', org-scoped,
 * idempotente). Canon §11.3 tem 'reversed' exatamente para refund total.
 * Novo no P3 — o webhook P2 nunca reverteu o payment. payments não tem
 * updated_at (só created_at); não setar. Zero-migration.
 */
export async function markPaymentReversed(orgId: string, chargeId: string): Promise<void> {
  await getDb().execute(sql`
    UPDATE payments SET status = 'reversed'
    WHERE organization_id = ${orgId} AND charge_id = ${chargeId} AND status = 'paid'`);
}

/**
 * Gate de confirmação (canon §8.4 step 10): pago confirma o appointment.
 * A coluna `confirmed_at` não existe no schema (appointments §calendar) — a
 * confirmação é uma transição de `status` ('scheduled' → 'confirmed'),
 * espelhando transitionAppointment (booking.ts). Guard só-forward: WHERE
 * status='scheduled' (idempotente; não regride 'confirmed', nem sobrescreve
 * estados terminais 'cancelled'/'completed'/'no_show'). Org-scoped.
 */
export async function confirmAppointmentIfUnconfirmed(
  orgId: string,
  appointmentId: string,
): Promise<void> {
  await getDb().execute(sql`
    UPDATE appointments SET status = 'confirmed', updated_at = now()
    WHERE id = ${appointmentId} AND organization_id = ${orgId} AND status = 'scheduled'`);
}

/**
 * Audit de charge — espelha insertWaitlistAudit (P1 tem uma fn de
 * audit-insert por entidade, com entity_type literal; insertPaymentAudit
 * hardcoda 'payment_account' e NÃO serve). entity_type='charge'
 * (audit_events.entity_type = text livre s/ CHECK → zero migration).
 *
 * P4: actorId/reasonText opcionais (ações manuais exigem ator + motivo;
 * SEV-M-05). Callers system pré-existentes os omitem → NULL, byte-idêntico
 * ao INSERT anterior. execution_id permanece NULL (audit de charge não é
 * AISuggestion-driven).
 */
export async function insertChargeAudit(input: {
  organizationId: string;
  chargeId: string;
  action: string;
  actorType: "system" | "user";
  actorId?: string;
  reasonText?: string;
  afterJson: Record<string, unknown>;
}): Promise<void> {
  await getDb().execute(sql`
    INSERT INTO audit_events
      (organization_id, entity_type, entity_id, action, actor_type, actor_id,
       reason_text, execution_id, after_json)
    VALUES (${input.organizationId}, 'charge', ${input.chargeId},
            ${input.action}, ${input.actorType}, ${input.actorId ?? null}, ${input.reasonText ?? null}, NULL,
            ${JSON.stringify(input.afterJson)}::jsonb)`);
}

/**
 * Resolve users.id (uuid) a partir do clerk_user_id, org-scoped. NULL se
 * ausente. Padrão canônico do "actor audit" das ações manuais: audit_events.
 * actor_id é coluna `uuid`, mas o ator na rota é req.auth.clerk_user_id (id
 * Clerk `user_...`, NÃO uuid). Esta fn faz a ponte clerk_user_id → users.id.
 */
export async function getUserIdByClerkId(
  orgId: string,
  clerkUserId: string,
): Promise<string | null> {
  const r = await getDb().execute(sql`
    SELECT id FROM users
    WHERE organization_id = ${orgId} AND clerk_user_id = ${clerkUserId} LIMIT 1`);
  return (r.rows[0] as { id: string } | undefined)?.id ?? null;
}

/**
 * MERGE de chaves de POLÍTICA em split_config_json (M5-P3a PATCH). `||` shallow
 * preserva platform_fee_percent + chaves existentes; só sobrescreve as do patch.
 * COALESCE(...,'{}') cobre split_config_json NULL. account_holder_type=
 * 'organization' (container per-org, qualquer provider). CTE com `FOR UPDATE`
 * serializa PATCHes concorrentes na mesma conta → before/after é um par
 * consistente; merge+audit no mesmo `withPaymentTx`. null se a org não tem
 * conta org-level (caller → 404). tx-aware (dbOrTx).
 */
export async function updatePaymentAccountPolicy(
  orgId: string,
  patch: Record<string, unknown>,
  dbOrTx?: DbOrTx,
): Promise<{ accountId: string; before: unknown; after: unknown } | null> {
  const exec = dbOrTx ?? getDb();
  const r = await exec.execute(sql`
    WITH prev AS (
      SELECT id, split_config_json AS before_json
      FROM payment_accounts
      WHERE organization_id = ${orgId} AND account_holder_type = 'organization'
      LIMIT 1
      FOR UPDATE
    )
    UPDATE payment_accounts pa
    SET split_config_json =
      COALESCE(pa.split_config_json, '{}'::jsonb) || ${JSON.stringify(patch)}::jsonb
    FROM prev
    WHERE pa.id = prev.id
    RETURNING pa.id AS account_id, prev.before_json AS before_json,
              pa.split_config_json AS after_json`);
  const row = r.rows[0] as
    | { account_id: string; before_json: unknown; after_json: unknown }
    | undefined;
  if (!row) return null;
  return { accountId: row.account_id, before: row.before_json, after: row.after_json };
}

/** split_config_json da payment_account org-level (NULL → null; default 0 no núcleo puro — P3a). */
export async function getSplitConfig(orgId: string): Promise<unknown> {
  const r = await getDb().execute(sql`
    SELECT split_config_json FROM payment_accounts
    WHERE organization_id = ${orgId} AND account_holder_type = 'organization' LIMIT 1`);
  const row = r.rows[0] as { split_config_json: unknown } | undefined;
  return row?.split_config_json ?? null;
}

/**
 * Política de pagamento efetiva per-org (M5-P3a GET). COALESCE fail-closed
 * (NÃO truthy-OR — ADR-018 ### 4: 0/false são overrides legítimos). O cast de
 * platform_fee_percent é guardado por regex → valor legado lixo nunca lança
 * (cai no default 0). Sem row → defaults canon. fee retorna string (pg numeric);
 * o service coerce p/ number. account_holder_type='organization' (qualquer provider).
 */
export async function getPaymentAccountPolicy(
  orgId: string,
): Promise<{ no_show_consumes_session: boolean; platform_fee_percent: string }> {
  const r = await getDb().execute(sql`
    SELECT
      COALESCE(
        CASE LOWER(split_config_json->>'no_show_consumes_session')
          WHEN 'true' THEN true WHEN 't' THEN true WHEN '1' THEN true
          WHEN 'false' THEN false WHEN 'f' THEN false WHEN '0' THEN false
          ELSE NULL END,
        false
      ) AS no_show_consumes_session,
      COALESCE(
        CASE WHEN split_config_json->>'platform_fee_percent' ~ '^[0-9]+(\\.[0-9]+)?$'
             THEN (split_config_json->>'platform_fee_percent')::numeric
             ELSE NULL END,
        0
      ) AS platform_fee_percent
    FROM payment_accounts
    WHERE organization_id = ${orgId} AND account_holder_type = 'organization'
    LIMIT 1`);
  const row = r.rows[0] as
    | { no_show_consumes_session: boolean; platform_fee_percent: string | number }
    | undefined;
  if (!row) return { no_show_consumes_session: false, platform_fee_percent: "0" };
  return {
    no_show_consumes_session: row.no_show_consumes_session === true,
    platform_fee_percent: String(row.platform_fee_percent),
  };
}
