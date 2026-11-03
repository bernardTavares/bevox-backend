/** Payments endpoints P1 (canon ADR-014 / PRD §5.6) — org-scoped + Stripe redirects. */
import type { FastifyInstance, FastifyPluginAsync } from "fastify";
import { z } from "zod";

import { env } from "@/config/env.js";
import { errors } from "@/shared/errors.js";
import { logger } from "@/shared/logger.js";

import * as repo from "./repository.js";
import { isCheckoutPath, validateChargeInput } from "./charge-intent.js";
import { createCheckoutSession } from "./checkout.js";
import { validateRefundInput } from "./refund-intent.js";
import { validateServicePackageInput } from "./package-intent.js";
import {
  validateManualChargeInput,
  validateMarkPaidInput,
  validateManualRefundInput,
  validateManualExpireInput,
} from "./manual.js";
import { validatePaymentPolicyPatch } from "./policy.js";
import {
  connectPaymentAccount,
  createCharge,
  reconcileFromStripe,
  refreshAccountLink,
  refundCharge,
  createServicePackage,
  connectManualAccount,
  createManualCharge,
  markChargePaidManually,
  refundChargeManually,
  expireChargeManually,
  readPaymentAccountPolicy,
  setPaymentAccountPolicy,
} from "./service.js";

const uuid = z.string().uuid();
const orgParam = z.object({ organization_id: uuid });
const orgQuery = z.object({ org: uuid });

// Query-boolean: URL strings literally — `?flag=true` → true, `?flag=false` → false,
// missing → default. `z.coerce.boolean()` would Boolean()-coerce, which inverts
// `'false'` → `true` (truthy non-empty string). Strict literal enum is the only
// safe form for HTTP query booleans.
const boolQuery = z
  .enum(["true", "false"])
  .default("false")
  .transform((s) => s === "true");

const plugin: FastifyPluginAsync = async (app: FastifyInstance) => {
  const read = { preHandler: [app.requireClerkAuth(), app.requireOrganizationScope()] };
  const write = {
    preHandler: [app.requireClerkAuth(), app.requireOrganizationScope(), app.requireIdempotency()],
  };
  // Manual-mode mutations sem idempotency-key (connect / mark-paid / expire):
  // idempotência vem da construção do service (createManualAccount ON CONFLICT,
  // applyChargePaid guarded, markChargeExpired transição guardada), não do
  // header. create-manual + refund-manual usam `write` (precisam da idem key).
  const mutate = { preHandler: [app.requireClerkAuth(), app.requireOrganizationScope()] };
  const B = "/api/v1/organizations/:organization_id";

  app.post(`${B}/payment-account/connect`, write, async (req, reply) => {
    const { organization_id } = orgParam.parse(req.params);
    const out = await connectPaymentAccount(organization_id, "user");
    return reply.status(201).send({
      onboarding_url: out.onboardingUrl,
      payment_account: { id: out.paymentAccountId, onboarding_status: out.onboardingStatus },
    });
  });

  app.get(`${B}/payment-account`, read, async (req, reply) => {
    const { organization_id } = orgParam.parse(req.params);
    const acct = await repo.getByOrg(organization_id);
    if (!acct) throw errors.notFound("PaymentAccount", organization_id);
    if (acct.onboarding_status === "pending" && acct.external_account_id) {
      const staleMin = env().PAYMENTS_RECONCILE_STALENESS_MINUTES;
      try {
        if (await repo.isStale(organization_id, staleMin)) {
          await reconcileFromStripe(acct);
        }
      } catch (e) {
        logger().warn({ orgId: organization_id, err: e }, "payment reconcile-on-read skipped");
      }
    }
    const fresh = await repo.getByOrg(organization_id);
    return reply.status(200).send({ payment_account: fresh });
  });

  app.get(`${B}/payment-account/policy`, read, async (req, reply) => {
    const { organization_id } = orgParam.parse(req.params);
    const policy = await readPaymentAccountPolicy(organization_id);
    return reply.status(200).send({ policy });
  });

  app.patch(`${B}/payment-account/policy`, mutate, async (req, reply) => {
    const { organization_id } = orgParam.parse(req.params);
    const v = validatePaymentPolicyPatch(req.body);
    if (!v.success) throw errors.invalidInput("invalid policy patch");
    const policy = await setPaymentAccountPolicy(organization_id, v.data, {
      clerkUserId: req.auth!.clerk_user_id,
    });
    return reply.status(200).send({ policy });
  });

  app.post(`${B}/charges`, write, async (req, reply) => {
    const { organization_id } = orgParam.parse(req.params);
    const idemKey = req.headers["idempotency-key"] as string;
    const v = validateChargeInput(req.body);
    if (!v.success) throw errors.invalidInput("invalid charge params");
    // POC payment-link-stripe-checkout-not-implemented (foundation): o
    // schema aceita `checkout` (PRD §5.6 / ADR-014) mas o flow Stripe
    // Checkout só é entregue em M5-P5. Guard PRÉ-IO devolve 501 — distinção
    // explícita entre 400 (payload inválido) e 501 (futuro com plano).
    // Chama o stub para manter o seam load-bearing: qualquer regressão que
    // provisione IO acidentalmente em M5-P5 cai aqui.
    if (isCheckoutPath(v.data)) {
      await createCheckoutSession({
        organizationId: organization_id,
        chargeId: "pending-stub",
        amountTotal: v.data.amount_total,
        feeCents: 0,
        destination: "pending-stub",
        idempotencyKey: idemKey,
      });
    }
    const out = await createCharge(organization_id, v.data, idemKey, "user");
    return reply.status(201).send({
      charge_id: out.charge_id,
      status: out.status,
      pix: out.pix,
    });
  });

  app.get(`${B}/charges/:charge_id`, read, async (req, reply) => {
    const { organization_id } = orgParam.parse(req.params);
    const { charge_id } = z.object({ charge_id: uuid }).parse(req.params);
    const c = await repo.getChargeById(organization_id, charge_id);
    if (!c) throw errors.notFound("Charge", charge_id);
    const expired =
      c.status === "pending" &&
      c.expires_at !== null &&
      new Date(c.expires_at).getTime() < Date.now();
    // Projeção client-facing explícita (charge-flow audit): NÃO ecoar
    // provider_charge_id (id do PaymentIntent Stripe = linkagem interna,
    // sem razão de contrato p/ o cliente). status = derivado on-read.
    return reply.status(200).send({
      charge: {
        id: c.id,
        organization_id: c.organization_id,
        customer_id: c.customer_id,
        appointment_id: c.appointment_id,
        service_id: c.service_id,
        professional_id: c.professional_id,
        payment_account_id: c.payment_account_id,
        charge_type: c.charge_type,
        status: expired ? "expired" : c.status,
        amount_total: c.amount_total,
        amount_platform_fee: c.amount_platform_fee,
        currency: c.currency,
        payment_method: c.payment_method,
        expires_at: c.expires_at,
        paid_at: c.paid_at,
      },
    });
  });

  app.post(`${B}/charges/:charge_id/refund`, write, async (req, reply) => {
    const { organization_id } = orgParam.parse(req.params);
    const { charge_id } = z.object({ charge_id: uuid }).parse(req.params);
    const idemKey = req.headers["idempotency-key"] as string;
    const v = validateRefundInput(req.body);
    if (!v.success) throw errors.invalidInput("invalid refund params");
    const out = await refundCharge(organization_id, charge_id, v.data, idemKey, "user");
    // Projeção client-facing explícita (lição charge-flow audit P2 Task 7):
    // não ecoa a row inteira de refund.
    return reply.status(201).send({
      refund: {
        provider_refund_id: out.provider_refund_id,
        status: out.status,
        amount: out.amount,
        reason_code: out.reason_code,
      },
    });
  });

  // P4: Catálogo ServicePackage (canon §1.6:998 — GET/POST).
  app.post(`${B}/service-packages`, write, async (req, reply) => {
    const { organization_id } = orgParam.parse(req.params);
    const v = validateServicePackageInput(req.body);
    if (!v.success) throw errors.invalidInput("invalid service-package params");
    const out = await createServicePackage(organization_id, v.data, "user");
    // Re-read for canonical DB-shape projection (string-decimal numerics +
    // created_at/updated_at) — mirrors the createCharge → projection pattern.
    const sp = await repo.getServicePackageById(organization_id, out.service_package_id);
    if (!sp) throw errors.internal("service-package created but not found");
    return reply.status(201).send({
      service_package: {
        id: sp.id,
        organization_id: sp.organization_id,
        name: sp.name,
        service_id: sp.service_id,
        sessions_included: sp.sessions_included,
        price_amount: sp.price_amount,
        validity_days: sp.validity_days,
        is_active: sp.is_active,
        created_at: sp.created_at,
        updated_at: sp.updated_at,
      },
    });
  });

  app.get(`${B}/service-packages`, read, async (req, reply) => {
    const { organization_id } = orgParam.parse(req.params);
    const q = z.object({ include_inactive: boolQuery }).parse(req.query);
    const list = await repo.listServicePackages(organization_id, {
      includeInactive: q.include_inactive,
    });
    return reply.status(200).send({
      service_packages: list.map((sp) => ({
        id: sp.id,
        organization_id: sp.organization_id,
        name: sp.name,
        service_id: sp.service_id,
        sessions_included: sp.sessions_included,
        price_amount: sp.price_amount,
        validity_days: sp.validity_days,
        is_active: sp.is_active,
        created_at: sp.created_at,
        updated_at: sp.updated_at,
      })),
    });
  });

  app.get(`${B}/customer-packages`, read, async (req, reply) => {
    const { organization_id } = orgParam.parse(req.params);
    const q = z
      .object({
        customer_id: uuid,
        include_terminal: boolQuery,
      })
      .parse(req.query);
    const list = await repo.listCustomerPackagesByCustomer(organization_id, q.customer_id, {
      includeTerminal: q.include_terminal,
    });
    // Effective-on-read expiry projection (precedente charges P2 'expired').
    const todayIso = new Date().toISOString().slice(0, 10);
    return reply.status(200).send({
      customer_packages: list.map((cp) => {
        const projectedStatus =
          cp.status === "active" && cp.valid_until !== null && cp.valid_until < todayIso
            ? "expired"
            : cp.status;
        return {
          id: cp.id,
          organization_id: cp.organization_id,
          customer_id: cp.customer_id,
          service_package_id: cp.service_package_id,
          charge_id: cp.charge_id,
          status: projectedStatus,
          sessions_total: cp.sessions_total,
          sessions_used: cp.sessions_used,
          sessions_remaining: cp.sessions_remaining,
          valid_until: cp.valid_until,
          created_at: cp.created_at,
          updated_at: cp.updated_at,
        };
      }),
    });
  });

  // M5-P4 Manual Payment Mode (canon ADR-023 / PRD §5.6): a org gerencia o
  // dinheiro fora-de-banda; Bevox só registra no ledger. 5 rotas REST normais
  // autenticadas (clerk + org-scope) — pertencem à superfície OpenAPI.
  app.post(`${B}/payment-account/connect-manual`, mutate, async (req, reply) => {
    const { organization_id } = orgParam.parse(req.params);
    const out = await connectManualAccount(organization_id, {
      clerkUserId: req.auth!.clerk_user_id,
    });
    return reply.status(201).send({
      payment_account: { id: out.paymentAccountId, onboarding_status: out.onboardingStatus },
    });
  });

  app.post(`${B}/charges/manual`, write, async (req, reply) => {
    const { organization_id } = orgParam.parse(req.params);
    const idemKey = req.headers["idempotency-key"] as string;
    const v = validateManualChargeInput(req.body);
    if (!v.success) throw errors.invalidInput("invalid manual charge params");
    const out = await createManualCharge(organization_id, v.data, idemKey, {
      clerkUserId: req.auth!.clerk_user_id,
    });
    return reply.status(201).send(out);
  });

  app.post(`${B}/charges/:charge_id/mark-paid`, mutate, async (req, reply) => {
    const { organization_id } = orgParam.parse(req.params);
    const { charge_id } = z.object({ charge_id: uuid }).parse(req.params);
    const v = validateMarkPaidInput(req.body);
    if (!v.success) throw errors.invalidInput("invalid mark-paid params");
    const out = await markChargePaidManually(organization_id, charge_id, v.data, {
      clerkUserId: req.auth!.clerk_user_id,
    });
    return reply.status(200).send(out);
  });

  app.post(`${B}/charges/:charge_id/refund-manual`, write, async (req, reply) => {
    const { organization_id } = orgParam.parse(req.params);
    const { charge_id } = z.object({ charge_id: uuid }).parse(req.params);
    const idemKey = req.headers["idempotency-key"] as string;
    const v = validateManualRefundInput(req.body);
    if (!v.success) throw errors.invalidInput("invalid refund params");
    const out = await refundChargeManually(organization_id, charge_id, v.data, idemKey, {
      clerkUserId: req.auth!.clerk_user_id,
    });
    return reply.status(201).send({ refund: out });
  });

  app.post(`${B}/charges/:charge_id/expire`, mutate, async (req, reply) => {
    const { organization_id } = orgParam.parse(req.params);
    const { charge_id } = z.object({ charge_id: uuid }).parse(req.params);
    const v = validateManualExpireInput(req.body);
    if (!v.success) throw errors.invalidInput("invalid expire params");
    const out = await expireChargeManually(organization_id, charge_id, v.data, {
      clerkUserId: req.auth!.clerk_user_id,
    });
    return reply.status(200).send(out);
  });

  app.get("/api/v1/webhooks/stripe/connect-return", async (req, reply) => {
    const { org } = orgQuery.parse(req.query);
    try {
      const acct = await repo.getByOrg(org);
      if (acct?.external_account_id) {
        await reconcileFromStripe(acct);
      }
    } catch (e) {
      logger().warn({ orgId: org, err: e }, "connect-return reconcile skipped");
    }
    return reply.redirect(env().PAYMENTS_ONBOARDING_RETURN_URL);
  });

  app.get("/api/v1/webhooks/stripe/connect-refresh", async (req, reply) => {
    const { org } = orgQuery.parse(req.query);
    const url = await refreshAccountLink(org);
    if (!url) throw errors.notFound("PaymentAccount", org);
    return reply.redirect(url);
  });
};

export const paymentsRoutes = plugin;
