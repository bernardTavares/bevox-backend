/**
 * Stripe webhook (canon ADR-014). Plugin SCOPED: buffer content-type parser
 * registrado só neste escopo (Fastify encapsulation; sem mudança global,
 * sem dep nova além de stripe). Verifica Stripe-Signature via
 * stripe.webhooks.constructEvent (raw body obrigatório; tolerância 300s;
 * lança StripeSignatureVerificationError). Dedupe por stripe_event_id
 * (ON CONFLICT DO NOTHING). P1 trata só account.updated → onboarding_status
 * autoritativo; demais tipos = persistidos e 200 sem processar (P2 estende
 * o MESMO switch — extensão aditiva).
 *
 * REQUISITO DE OPS (não-código): o endpoint no Stripe Dashboard DEVE ser
 * Connect-scoped ("Connected accounts"), senão account.updated de conta
 * conectada nunca chega aqui. STRIPE_WEBHOOK_SECRET = o whsec_ desse endpoint.
 */
import type { FastifyInstance, FastifyPluginAsync } from "fastify";
import type Stripe from "stripe";

import { env } from "@/config/env.js";
import { errors } from "@/shared/errors.js";
import { logger } from "@/shared/logger.js";

import { getStripe } from "./stripe-client.js";
import * as repo from "./repository.js";
import { deriveOnboardingStatus, stripeAccountMirror } from "./status.js";

const plugin: FastifyPluginAsync = async (app: FastifyInstance) => {
  app.addContentTypeParser("application/json", { parseAs: "buffer" }, (_req, body, done) =>
    done(null, body),
  );

  app.post("/api/v1/webhooks/stripe", async (req, reply) => {
    const secret = env().STRIPE_WEBHOOK_SECRET;
    if (!secret) throw errors.internal("STRIPE_WEBHOOK_SECRET ausente");
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

    const acctId = event.account ?? null;
    const known = acctId ? await repo.getByExternalId(acctId) : null;

    // Dedupe processed-aware: alreadyProcessed=true só quando uma entrega
    // anterior concluiu (markWebhookProcessed). Se foi gravado mas o
    // processamento falhou antes disso, reprocessa nesta reentrega (Stripe
    // reentrega 200-or-stop; processar account.updated é idempotente —
    // onboardingChanged-gated). Fecha a janela recorded-but-unprocessed.
    const recorded = await repo.recordWebhookEvent({
      organizationId: known?.organization_id ?? null,
      stripeEventId: event.id,
      type: event.type,
    });
    if (recorded.alreadyProcessed) {
      return reply.status(200).send({ deduped: true });
    }

    if (event.type === "account.updated") {
      if (known) {
        const sa = event.data.object as Stripe.Account;
        const accountish = {
          charges_enabled: !!sa.charges_enabled,
          payouts_enabled: !!sa.payouts_enabled,
          details_submitted: !!sa.details_submitted,
          requirements: sa.requirements
            ? { disabled_reason: sa.requirements.disabled_reason ?? null }
            : null,
        };
        const after = {
          onboarding_status: deriveOnboardingStatus(accountish),
          ...stripeAccountMirror(accountish),
        };
        const before = {
          onboarding_status: known.onboarding_status,
          charges_enabled: known.charges_enabled,
          payouts_enabled: known.payouts_enabled,
          details_submitted: known.details_submitted,
        };
        if (repo.onboardingChanged(before, after)) {
          // M5-P2a Item 4: atomic UPDATE + audit INSERT em single tx —
          // rollback automatic se segundo statement falha (elimina
          // inconsistent state após crash mid-pair durante account.updated).
          await repo.withPaymentTx(async (tx) => {
            await repo.updateOnboardingState(known.organization_id, known.id, after, tx);
            await repo.insertPaymentAudit(
              {
                organizationId: known.organization_id,
                paymentAccountId: known.id,
                action: "payment_account.status_changed",
                actorType: "system",
                afterJson: { ...after },
              },
              tx,
            );
          });
        }
      } else {
        logger().warn({ acctId }, "stripe account.updated for unknown connected account");
      }
    }

    await repo.markWebhookProcessed(recorded.id);
    return reply.status(200).send({ received: true });
  });
};

export const stripeWebhookRoutes = plugin;
