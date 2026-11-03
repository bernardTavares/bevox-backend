/**
 * Pure normalize: meta-api event envelope → received_events row shape.
 *
 * Provider inference from data shape:
 *   - messaging_product === "whatsapp" → "wa"
 *   - recipient.id + sender.id (Instagram shape) → "ig"
 *   - else → "unknown" (raw.* fallback)
 *
 * conversation_key: "channel:{provider}:{externalAccountId}:{externalConversationId}"
 *
 * Marco 4 P1.
 */

import type { MetaApiEventEnvelope } from "./schemas.js";

export type ChannelProvider = "wa" | "ig" | "unknown";

export interface NormalizedReceivedEvent {
  source: "metaapi";
  sourceEventKey: string; // event_id
  eventType: string;
  payloadJson: MetaApiEventEnvelope; // raw envelope
  normalizedPayloadJson: {
    conversation_key: string;
    provider: ChannelProvider;
    event_type: string;
    occurred_at: string;
    tenant_id: string | null;
  };
}

function detectProvider(data: unknown): ChannelProvider {
  if (data && typeof data === "object") {
    const d = data as Record<string, unknown>;
    if (d.messaging_product === "whatsapp") return "wa";
    if (
      d.recipient &&
      typeof d.recipient === "object" &&
      "id" in (d.recipient as object) &&
      d.sender &&
      typeof d.sender === "object" &&
      "id" in (d.sender as object)
    ) {
      return "ig";
    }
  }
  return "unknown";
}

export function normalizeMetaApiEvent(
  envelope: MetaApiEventEnvelope,
  ctx: { externalAccountId: string; externalConversationId: string },
): NormalizedReceivedEvent {
  const provider = detectProvider(envelope.data);
  const conversationKey = `channel:${provider}:${ctx.externalAccountId}:${ctx.externalConversationId}`;

  return {
    source: "metaapi",
    sourceEventKey: envelope.event_id,
    eventType: envelope.event_type,
    payloadJson: envelope,
    normalizedPayloadJson: {
      conversation_key: conversationKey,
      provider,
      event_type: envelope.event_type,
      occurred_at: envelope.occurred_at,
      tenant_id: envelope.tenant_id,
    },
  };
}
