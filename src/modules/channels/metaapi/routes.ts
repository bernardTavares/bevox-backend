/**
 * HTTP routes — bevox-meta-api inbound + health-check.
 *
 *   POST /api/v1/webhooks/metaapi/events
 *     Plugin SCOPED: buffer content-type parser registrado só neste escopo
 *     (Fastify encapsulation; precedente ingestion/payments webhooks).
 *     TWO body shapes discriminadas pelo conteúdo:
 *       (a) {verification_challenge: string} → 200 {challenge: echo}, NO HMAC.
 *       (b) {event_id, event_type, tenant_id, occurred_at, data} → HMAC
 *           validate + dedupe Redis SETNX 24h + normalize + persist em
 *           received_events + audit_events.
 *
 *   GET /api/v1/health/metaapi
 *     Staff-auth only (qualquer role). Verifica:
 *       (a) JWT mint local OK
 *       (b) channel_subscriptions tem ≥1 row active
 *       (c) organization_meta_api_tenant cobre 100% das organizations
 *     200 ok | 503 com checks detail.
 *
 * Single-subscription V1: lookup do signing_secret por status='active'
 * LIMIT 1 (plan §2034-2042). Multi-sub futuro = keyed por X-Bevox-Subscription
 * header sem breaking change desta route.
 *
 * Marco 4 P1.
 */

import type { FastifyInstance, FastifyPluginAsync, FastifyRequest } from "fastify";
import { sql } from "drizzle-orm";

import { getDb } from "@/db/client.js";
import { INGESTION_EVENT_QUEUE, getIngestionEventQueue } from "@/lib/queues.js";
import { getRedis } from "@/lib/redis.js";
import { upsertChannelConnection } from "@/modules/channels/repository.js";
import { errors } from "@/shared/errors.js";
import { logger } from "@/shared/logger.js";
import {
  metaapiInboundEventsTotal,
  metaapiInboundEventDedupeHitsTotal,
  metaapiSubscriptionStatus,
} from "@/shared/metrics.js";
import { uuidv7 } from "@/shared/uuid.js";

import { mintJwt } from "./client.js";
import { extractInboundMedia, extractInboundMessage } from "./inbound-dispatch.js";
import { normalizeMetaApiEvent } from "./normalize.js";
import {
  findOrgByMetaApiTenant,
  findSubscriptionById,
  insertMessageRecord,
  listOrgsMissingMetaApiTenant,
} from "./repository.js";
import {
  metaApiEventEnvelopeSchema,
  metaApiVerificationChallengeSchema,
  type MetaApiEventEnvelope,
} from "./schemas.js";
import { handleVerificationChallenge, validateBevoxSignature } from "./service.js";

const DEDUPE_PREFIX = "metaapi:event:";
const DEDUPE_TTL_SECONDS = 24 * 60 * 60; // 24h

/** Extrai (externalAccountId, externalConversationId) heurístico do data shape. */
function extractIds(envelope: MetaApiEventEnvelope): {
  externalAccountId: string;
  externalConversationId: string;
} {
  let externalAccountId = envelope.tenant_id ?? "unknown";
  let externalConversationId = envelope.event_id;
  const data = envelope.data;
  if (data && typeof data === "object") {
    const d = data as Record<string, unknown>;
    // WhatsApp shape: messaging_product + metadata.phone_number_id + messages[].from
    if (d.metadata && typeof d.metadata === "object") {
      const meta = d.metadata as Record<string, unknown>;
      if (typeof meta.phone_number_id === "string") {
        externalAccountId = meta.phone_number_id;
      }
    }
    if (Array.isArray(d.messages) && d.messages.length > 0) {
      const m = d.messages[0] as Record<string, unknown>;
      if (typeof m.from === "string") {
        externalConversationId = m.from;
      }
    }
    // Instagram shape: recipient.id (account) + sender.id (conversation peer)
    if (d.recipient && typeof d.recipient === "object") {
      const r = d.recipient as Record<string, unknown>;
      if (typeof r.id === "string") {
        externalAccountId = r.id;
      }
    }
    if (d.sender && typeof d.sender === "object") {
      const s = d.sender as Record<string, unknown>;
      if (typeof s.id === "string") {
        externalConversationId = s.id;
      }
    }
  }
  return { externalAccountId, externalConversationId };
}

const plugin: FastifyPluginAsync = async (app: FastifyInstance) => {
  // Raw body buffer (precedente ingestion/payments webhook): content-type parser
  // SCOPED ao plugin — sem mudança global. JSON parsing acontece downstream.
  app.addContentTypeParser("application/json", { parseAs: "buffer" }, (_req, body, done) =>
    done(null, body),
  );

  // ----- POST /api/v1/webhooks/metaapi/events -----
  app.post("/api/v1/webhooks/metaapi/events", async (req: FastifyRequest, reply) => {
    const raw = req.body as Buffer;
    const rawBuf = Buffer.isBuffer(raw) ? raw : Buffer.from("");
    const rawBody = rawBuf.toString("utf8");

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawBody);
    } catch {
      throw errors.invalidInput("Invalid JSON payload");
    }

    // Path (a): verification challenge (no HMAC required).
    const challengeResult = metaApiVerificationChallengeSchema.safeParse(parsed);
    if (challengeResult.success) {
      const echo = handleVerificationChallenge(challengeResult.data);
      return reply.status(200).send(echo);
    }

    // Path (b): canonical event envelope with HMAC.
    const envelopeResult = metaApiEventEnvelopeSchema.safeParse(parsed);
    if (!envelopeResult.success) {
      metaapiInboundEventsTotal.inc({ event_type: "unknown", status: "rejected_payload" });
      throw errors.invalidInput("body neither verification_challenge nor canonical event envelope");
    }
    const envelope = envelopeResult.data;

    // Resolve subscription — V1 single-sub backend-wide (plan §2034-2042).
    // Multi-sub futuro = keyed por X-Bevox-Subscription header.
    const db = getDb();
    const subRowsRes = await db.execute(
      sql`SELECT subscription_id FROM channel_subscriptions
            WHERE status = 'active'
            LIMIT 1`,
    );
    const subIdRows = subRowsRes.rows as unknown as Array<{ subscription_id: string }>;
    if (subIdRows.length === 0) {
      metaapiInboundEventsTotal.inc({ event_type: envelope.event_type, status: "rejected_hmac" });
      throw errors.unauthenticated("no active subscription");
    }
    const sub = await findSubscriptionById(subIdRows[0]!.subscription_id);
    if (!sub) {
      metaapiInboundEventsTotal.inc({ event_type: envelope.event_type, status: "rejected_hmac" });
      throw errors.unauthenticated("subscription not found");
    }

    // HMAC validation (Stripe-style, t=<unix>,v1=<hex>, ±300s tolerance).
    const sigHeader = (req.headers["x-bevox-signature"] as string | undefined) ?? "";
    const validation = validateBevoxSignature({
      headerValue: sigHeader,
      rawBody,
      signingSecret: sub.signingSecret,
    });
    if (!validation.valid) {
      logger().warn(
        { subscription_id: sub.subscriptionId, reason: validation.reason },
        "metaapi.inbound.hmac_invalid",
      );
      metaapiInboundEventsTotal.inc({ event_type: envelope.event_type, status: "rejected_hmac" });
      throw errors.unauthenticated("Invalid Bevox signature");
    }

    // Dedupe via event_id Redis SETNX TTL 24h.
    const dedupeKey = `${DEDUPE_PREFIX}${envelope.event_id}`;
    const isNew = await getRedis().set(dedupeKey, "1", "EX", DEDUPE_TTL_SECONDS, "NX");
    if (isNew === null) {
      metaapiInboundEventDedupeHitsTotal.inc();
      metaapiInboundEventsTotal.inc({ event_type: envelope.event_type, status: "replayed" });
      return reply.status(200).send({ status: "replayed", event_id: envelope.event_id });
    }

    // Resolve tenant → organization (when tenant_id present in envelope).
    let organizationId: string | null = null;
    if (envelope.tenant_id) {
      organizationId = await findOrgByMetaApiTenant(envelope.tenant_id);
      if (!organizationId) {
        metaapiInboundEventsTotal.inc({
          event_type: envelope.event_type,
          status: "rejected_payload",
        });
        throw errors.notFound("tenant not mapped to any organization");
      }
    }

    // Normalize + persist em received_events (idempotent via ON CONFLICT).
    const { externalAccountId, externalConversationId } = extractIds(envelope);
    const normalized = normalizeMetaApiEvent(envelope, {
      externalAccountId,
      externalConversationId,
    });

    const receivedEventId = uuidv7();
    await db.execute(
      sql`INSERT INTO received_events
            (id, source, source_event_key, event_type, payload_json,
             normalized_payload_json, signature_valid)
          VALUES (${receivedEventId}, ${normalized.source}, ${normalized.sourceEventKey},
                  ${normalized.eventType},
                  ${JSON.stringify(normalized.payloadJson)}::jsonb,
                  ${JSON.stringify(normalized.normalizedPayloadJson)}::jsonb,
                  TRUE)
          ON CONFLICT (source, source_event_key) DO NOTHING`,
    );

    // Audit event — entity_type='metaapi_event'.
    await db.execute(
      sql`INSERT INTO audit_events
            (id, organization_id, entity_type, entity_id, action,
             actor_type, after_json)
          VALUES (${uuidv7()}, ${organizationId}, 'metaapi_event',
                  ${envelope.event_id}, 'metaapi.event.accepted', 'system',
                  ${JSON.stringify({
                    event_type: envelope.event_type,
                    tenant_id: envelope.tenant_id,
                    organization_id: organizationId,
                    subscription_id: sub.subscriptionId,
                  })}::jsonb)`,
    );

    // P4/P3c: plug AI dispatch flow for message.received events. Persist quando
    // há texto OU media (media-only no longer dropped — M5-P3c CRITICAL fix).
    // Try/catch + DEL dedupe key on caught exception: garante Meta retry
    // refaz dispatch (sem DEL, retry vê "replayed" e dispatch silently lost).
    // received_events + audit_events ON CONFLICT idempotent; safe replay.
    if (envelope.event_type === "message.received" && organizationId) {
      const extracted = extractInboundMessage(envelope);
      const media = extractInboundMedia(envelope);
      const provider = normalized.normalizedPayloadJson.provider;
      if (
        extracted &&
        (provider === "wa" || provider === "ig") &&
        (extracted.contentText !== null || media)
      ) {
        try {
          // (a) Seed channel_connections row if missing (Agent #3 HIGH-1 fix).
          // Idempotent UPSERT on (provider, external_account_id) — safe replay.
          await upsertChannelConnection({
            organizationId,
            provider,
            externalAccountId,
            status: "connected",
            routingConfigJson: {},
          });

          // (b) Persist message_records row (ON CONFLICT idempotent).
          await insertMessageRecord({
            receivedEventId,
            conversationKey: normalized.normalizedPayloadJson.conversation_key,
            externalMessageId: extracted.externalMessageId,
            direction: extracted.direction,
            contentText: extracted.contentText, // may be null (media-only)
            messageCreatedAt: extracted.messageCreatedAt,
            senderSnapshotJson: extracted.senderSnapshotJson,
            mediaJson: media, // null when no media
          });

          // (c) Enqueue ingestion-event for AI dispatch worker.
          await getIngestionEventQueue().add(INGESTION_EVENT_QUEUE, {
            received_event_id: receivedEventId,
            conversation_key: normalized.normalizedPayloadJson.conversation_key,
            event_type: envelope.event_type,
            organization_id: organizationId,
            external_account_id: externalAccountId,
          });
        } catch (err) {
          // Agent #3 HIGH-2 fix: DEL dedupe key so Meta retry refaz dispatch.
          // Without DEL, retry would be short-circuited as "replayed" and lost.
          // Wrap DEL em .catch noop: se Redis flap entre SETNX+DEL, original
          // err preserva root cause em 5xx response (24h TTL eventually frees
          // the dedupe key) — Agent closeout SEV-M-1 fix.
          await getRedis()
            .del(dedupeKey)
            .catch(() => {});
          throw err;
        }
      }
    }

    metaapiInboundEventsTotal.inc({ event_type: envelope.event_type, status: "accepted" });

    return reply.status(200).send({ status: "accepted", event_id: envelope.event_id });
  });

  // ----- GET /api/v1/health/metaapi -----
  app.get(
    "/api/v1/health/metaapi",
    {
      preHandler: [app.requireStaff({ roles: ["bevox_admin", "bevox_support", "bevox_observer"] })],
    },
    async (_req, reply) => {
      const checks: Record<string, unknown> = {};

      // (a) JWT mint local OK.
      try {
        await mintJwt(["webhooks:read"]);
        checks.jwt_ok = true;
      } catch (e) {
        checks.jwt_ok = false;
        checks.jwt_error = (e as Error).message;
      }

      // (b) ≥1 subscription active.
      try {
        const res = await getDb().execute(
          sql`SELECT subscription_id, status FROM channel_subscriptions
                WHERE status = 'active'
                LIMIT 1`,
        );
        const rows = res.rows as unknown as Array<{
          subscription_id: string;
          status: string;
        }>;
        if (rows.length > 0) {
          checks.subscription_active = true;
          checks.subscription_id = rows[0]!.subscription_id;
          metaapiSubscriptionStatus.set({ subscription_id: rows[0]!.subscription_id }, 1);
        } else {
          checks.subscription_active = false;
        }
      } catch (e) {
        checks.subscription_active = false;
        checks.subscription_error = (e as Error).message;
      }

      // (c) tenant mapping integrity — toda organization tem 1 row em
      // organization_meta_api_tenant (M4 P1 garante via tenant-bootstrap T14).
      try {
        const gaps = await listOrgsMissingMetaApiTenant();
        checks.tenant_mapping_complete = gaps.length === 0;
        checks.tenant_mapping_gaps = gaps;
      } catch (e) {
        checks.tenant_mapping_complete = false;
        checks.tenant_mapping_error = (e as Error).message;
      }

      const allOk =
        checks.jwt_ok === true &&
        checks.subscription_active === true &&
        checks.tenant_mapping_complete === true;

      return reply.status(allOk ? 200 : 503).send({ ok: allOk, checks });
    },
  );
};

export const metaapiRoutes = plugin;
