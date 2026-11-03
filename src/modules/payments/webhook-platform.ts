/**
 * Stripe webhook PLATFORM-scoped (Payments P2, canon ADR-014). Endpoint
 * DISTINTO do P1 Connect-scoped (/api/v1/webhooks/stripe inalterado):
 * destination charge cria o PaymentIntent no escopo PLATAFORMA, então
 * payment_intent.* e refund.* chegam aqui com secret próprio
 * (STRIPE_WEBHOOK_SECRET_PLATFORM). Plugin SCOPED: buffer content-type
 * parser só neste escopo (Fastify encapsulation; espelha webhook.ts P1).
 * Dedupe reusa stripe_webhook_events (processed-aware P1). Resolução de
 * org: event.account é null (escopo plataforma) → metadata do PI; refund
 * resolve a charge por refund.payment_intent ↔ provider_charge_id.
 *
 * REQUISITO DE OPS: endpoint no Dashboard escopo "Your account"
 * (connect:false) cobrindo payment_intent.* e refund.*.
 * STRIPE_WEBHOOK_SECRET_PLATFORM = o whsec_ desse endpoint.
 */
import type { FastifyInstance, FastifyPluginAsync } from "fastify";
import type Stripe from "stripe";

import { env } from "@/config/env.js";
import { errors } from "@/shared/errors.js";
import { logger } from "@/shared/logger.js";

import { getStripe } from "./stripe-client.js";
import * as repo from "./repository.js";
import { mapRefundStatus } from "./charge-intent.js";

const plugin: FastifyPluginAsync = async (app: FastifyInstance) => {
  app.addContentTypeParser("application/json", { parseAs: "buffer" }, (_req, body, done) =>
    done(null, body),
  );

  app.post("/api/v1/webhooks/stripe/platform", async (req, reply) => {
    const secret = env().STRIPE_WEBHOOK_SECRET_PLATFORM;
    if (!secret) throw errors.internal("STRIPE_WEBHOOK_SECRET_PLATFORM ausente");
    const raw = req.body as Buffer;
    const sig = req.headers["stripe-signature"] as string | undefined;

    let event: Stripe.Event;
    try {
      event = getStripe().webhooks.constructEvent(
        Buffer.isBuffer(raw) ? raw : Buffer.from(""),
        sig ?? "",
        secret,
      );
    } catch {
      throw errors.unauthenticated("Invalid Stripe signature");
    }

    // Resolve org/charge ANTES do dedupe (org pode ser null se desconhecida
    // — persiste mesmo assim, política P1). A resolução SEMPRE deriva de uma
    // linha do DB (charge-flow audit I1): metadata do PI é signature-verified
    // mas não-confiável transitivamente — getChargeById é org-scoped, então
    // um par (org, charge) inconsistente → null → nenhuma mutação de dinheiro
    // (mesma disciplina do path de refund: derivar de chargeRow, não da
    // metadata crua). Cross-tenant paid-flip impossível por construção.
    let orgId: string | null = null;
    let chargeId: string | null = null;
    let chargeRow: repo.ChargeRow | null = null;

    if (
      event.type === "payment_intent.succeeded" ||
      event.type === "payment_intent.payment_failed"
    ) {
      const pi = event.data.object as Stripe.PaymentIntent;
      const mOrg = (pi.metadata?.organization_id as string | undefined) ?? null;
      const mChg = (pi.metadata?.charge_id as string | undefined) ?? null;
      if (mOrg && mChg) {
        chargeRow = await repo.getChargeById(mOrg, mChg);
        if (chargeRow) {
          orgId = chargeRow.organization_id;
          chargeId = chargeRow.id;
        }
      }
    } else if (
      event.type === "refund.created" ||
      event.type === "refund.updated" ||
      event.type === "refund.failed"
    ) {
      const rf = event.data.object as Stripe.Refund;
      const piId = typeof rf.payment_intent === "string" ? rf.payment_intent : null;
      if (piId) {
        chargeRow = await repo.getChargeByProviderId(piId);
        if (chargeRow) {
          orgId = chargeRow.organization_id;
          chargeId = chargeRow.id;
        }
      }
    }

    const recorded = await repo.recordWebhookEvent({
      organizationId: orgId,
      stripeEventId: event.id,
      type: event.type,
    });
    if (recorded.alreadyProcessed) {
      return reply.status(200).send({ deduped: true });
    }

    if (event.type === "payment_intent.succeeded") {
      if (orgId && chargeId && chargeRow) {
        const pi = event.data.object as Stripe.PaymentIntent;
        // T4: orquestração pós-pago compartilhada (Stripe webhook + manual)
        // extraída p/ service.applyChargePaid — os SEIS efeitos byte-idênticos
        // (markChargePaid → insertPayment → confirmAppointment → audit →
        // re-load → grant). Dynamic import preservado (evita circular import;
        // o grant P4 já usava import dinâmico aqui).
        const { applyChargePaid } = await import("./service.js");
        await applyChargePaid(
          orgId,
          chargeRow,
          new Date(),
          {
            status: "paid",
            providerPaymentId: pi.id,
            amountPaid: (pi.amount_received ?? pi.amount) / 100,
            currency: (pi.currency ?? "brl").toUpperCase(),
            rawPayloadJson: event as unknown as Record<string, unknown>,
          },
          { action: "charge.paid", actorType: "system" },
        );
      } else {
        logger().warn({ eventId: event.id }, "payment_intent.succeeded without resolvable charge");
      }
    } else if (event.type === "payment_intent.payment_failed") {
      if (orgId && chargeId) {
        const pi = event.data.object as Stripe.PaymentIntent;
        await repo.insertPayment({
          organizationId: orgId,
          chargeId,
          status: "failed",
          providerPaymentId: pi.id,
          amountPaid: (pi.amount ?? 0) / 100,
          currency: (pi.currency ?? "brl").toUpperCase(),
          paidAt: null,
          rawPayloadJson: event as unknown as Record<string, unknown>,
        });
        await repo.insertChargeAudit({
          organizationId: orgId,
          chargeId,
          action: "charge.payment_failed",
          actorType: "system",
          afterJson: { provider_payment_id: pi.id, status: "failed" },
        });
        // charge permanece 'pending' (Pix re-tentável até expirar; não cancela).
      } else {
        logger().warn(
          { eventId: event.id },
          "payment_intent.payment_failed without resolvable charge",
        );
      }
    } else if (event.type === "refund.created" || event.type === "refund.updated") {
      if (orgId && chargeId && chargeRow) {
        // refund.failed é tratado EXCLUSIVAMENTE no else-if próprio abaixo
        // (intencionalmente fora desta cláusula) — não fundir as condições.
        const rf = event.data.object as Stripe.Refund;
        await repo.recordRefund({
          organizationId: orgId,
          chargeId,
          status: mapRefundStatus(rf.status),
          amount: (rf.amount ?? 0) / 100,
          providerRefundId: rf.id,
        });
        // recordRefund é insert-once (P2); com a iniciação P3 gravando
        // 'pending' primeiro, sem isto refunds.status ficaria 'pending'
        // para sempre. Transição só-forward, idempotente. updateRefundStatus
        // só aceita estado terminal; 'pending' seria no-op de toda forma
        // (a row já está 'pending', e o guard WHERE status='pending' é
        // só-forward), então só transiciona quando o status já resolveu.
        const rfStatus = mapRefundStatus(rf.status);
        if (rfStatus === "succeeded" || rfStatus === "failed") {
          await repo.updateRefundStatus(rf.id, rfStatus);
        }
        // Partial-refund: só charge→refunded se a SOMA CUMULATIVA das refund
        // rows PERSISTIDAS 'succeeded' atinge o total (markPaymentReversed é
        // NOVO no P3 — o webhook P2 nunca tocou payments no refund).
        // SEV-HIGH fix (charge-flow audit): a transição charge→refunded /
        // payment→reversed é gated na soma PERSISTIDA autoritativa dos refunds
        // (só rows 'succeeded' contam) — NÃO no payload do evento individual.
        // sumSucceededRefundsCents inclui a row recém-marcada 'succeeded' por
        // updateRefundStatus acima; um refund.failed/canceled out-of-order
        // não conta (não está 'succeeded'). Recomputo cumulativo também corrige
        // o caso "dois parciais que somam o total = full" (latent bug pré-T5).
        const { applyChargeRefunded } = await import("./service.js");
        await applyChargeRefunded(orgId, chargeRow, {
          action: "charge.refund_recorded",
          actorType: "system",
          providerRefundId: rf.id,
        });
        await repo.insertChargeAudit({
          organizationId: orgId,
          chargeId,
          action: "charge.refund_recorded",
          actorType: "system",
          afterJson: {
            provider_refund_id: rf.id,
            status: mapRefundStatus(rf.status),
            amount: (rf.amount ?? 0) / 100,
          },
        });
      } else {
        logger().warn({ eventId: event.id }, "refund event without resolvable charge");
      }
    } else if (event.type === "refund.failed") {
      if (orgId && chargeId) {
        const rf = event.data.object as Stripe.Refund;
        // refund.failed é evento DISTINTO de refund.updated (Stripe-docs
        // double-check BLOCKER): um refund Pix/connect falho pode vir só
        // por aqui. Sem tratá-lo a row fica 'pending' para sempre e o
        // cliente não é estornado, silenciosamente. NÃO marca
        // charge/payment — o refund falhou, a charge segue 'paid'.
        const transitioned = await repo.updateRefundStatus(rf.id, "failed");
        // SEV-LOW (charge-flow audit): só audita charge.refund_failed se a
        // row REALMENTE transicionou pending→failed; uma reentrega/ordem
        // invertida sobre uma refund já terminal (p.ex. já succeeded) não
        // emite trilha de auditoria enganosa.
        if (transitioned) {
          await repo.insertChargeAudit({
            organizationId: orgId,
            chargeId,
            action: "charge.refund_failed",
            actorType: "system",
            afterJson: {
              provider_refund_id: rf.id,
              status: "failed",
              amount: (rf.amount ?? 0) / 100,
            },
          });
        } else {
          logger().info(
            { eventId: event.id, refundId: rf.id },
            "refund.failed no-op (refund já terminal)",
          );
        }
      } else {
        logger().warn({ eventId: event.id }, "refund.failed without resolvable charge");
      }
    }
    // demais tipos: persistidos; P2 não processa (honesto, P1 idiom).

    await repo.markWebhookProcessed(recorded.id);
    return reply.status(200).send({ received: true });
  });
};

export const stripePlatformWebhookRoutes = plugin;
