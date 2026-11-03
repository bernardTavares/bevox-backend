import { describe, expect, it } from "vitest";

import { normalizeMetaApiEvent } from "@/modules/channels/metaapi/normalize.js";
import type { MetaApiEventEnvelope } from "@/modules/channels/metaapi/schemas.js";

function makeEnvelope(over: Partial<MetaApiEventEnvelope>): MetaApiEventEnvelope {
  return {
    event_id: "0193e45a-c5e4-7000-9000-000000000001",
    event_type: "message.received",
    tenant_id: "0193e45a-c5e4-7000-9000-000000000002",
    occurred_at: "2026-05-20T14:00:07.906Z",
    data: {},
    ...over,
  };
}

describe("normalizeMetaApiEvent — provider detection", () => {
  it("detects WhatsApp (messaging_product=whatsapp) → provider 'wa'", () => {
    const e = makeEnvelope({ data: { messaging_product: "whatsapp", from: "5511999" } });
    const r = normalizeMetaApiEvent(e, {
      externalAccountId: "waba_123",
      externalConversationId: "conv_456",
    });
    expect(r.normalizedPayloadJson.conversation_key).toBe("channel:wa:waba_123:conv_456");
  });

  it("detects Instagram (data has recipient.id + sender.id IG-shape) → provider 'ig'", () => {
    const e = makeEnvelope({
      data: { recipient: { id: "ig_acc_111" }, sender: { id: "ig_usr_222" } },
    });
    const r = normalizeMetaApiEvent(e, {
      externalAccountId: "ig_acc_111",
      externalConversationId: "ig_usr_222",
    });
    expect(r.normalizedPayloadJson.conversation_key).toBe("channel:ig:ig_acc_111:ig_usr_222");
  });

  it("falls back to provider 'unknown' if no shape match", () => {
    const e = makeEnvelope({ data: { weird: true } });
    const r = normalizeMetaApiEvent(e, { externalAccountId: "x", externalConversationId: "y" });
    expect(r.normalizedPayloadJson.conversation_key).toBe("channel:unknown:x:y");
  });
});

describe("normalizeMetaApiEvent — received_events row shape", () => {
  it("sets source='metaapi' + sourceEventKey=event_id", () => {
    const e = makeEnvelope({});
    const r = normalizeMetaApiEvent(e, { externalAccountId: "x", externalConversationId: "y" });
    expect(r.source).toBe("metaapi");
    expect(r.sourceEventKey).toBe(e.event_id);
  });

  it("propagates event_type to eventType column", () => {
    const e = makeEnvelope({ event_type: "message.status_updated" });
    const r = normalizeMetaApiEvent(e, { externalAccountId: "x", externalConversationId: "y" });
    expect(r.eventType).toBe("message.status_updated");
  });

  it("stores raw envelope as payloadJson", () => {
    const e = makeEnvelope({ data: { foo: "bar" } });
    const r = normalizeMetaApiEvent(e, { externalAccountId: "x", externalConversationId: "y" });
    expect(r.payloadJson).toEqual(e);
  });

  it("builds normalizedPayloadJson with conversation_key", () => {
    const e = makeEnvelope({ data: { messaging_product: "whatsapp" } });
    const r = normalizeMetaApiEvent(e, {
      externalAccountId: "waba_x",
      externalConversationId: "conv_y",
    });
    expect(r.normalizedPayloadJson).toMatchObject({
      conversation_key: "channel:wa:waba_x:conv_y",
      provider: "wa",
      event_type: "message.received",
    });
  });

  it("preserves occurred_at em normalizedPayloadJson", () => {
    const e = makeEnvelope({});
    const r = normalizeMetaApiEvent(e, { externalAccountId: "x", externalConversationId: "y" });
    expect(r.normalizedPayloadJson).toMatchObject({ occurred_at: e.occurred_at });
  });
});

describe("normalizeMetaApiEvent — canonical event types", () => {
  const eventTypes = [
    "message.received",
    "message.status_updated",
    "template.status_updated",
    "phone_number.quality_changed",
    "waba.connection_changed",
  ] as const;

  for (const et of eventTypes) {
    it(`accepts ${et}`, () => {
      const e = makeEnvelope({ event_type: et });
      const r = normalizeMetaApiEvent(e, { externalAccountId: "x", externalConversationId: "y" });
      expect(r.eventType).toBe(et);
    });
  }

  it("accepts raw.* fallback event_type", () => {
    const e = makeEnvelope({ event_type: "raw.whatsapp.foo" });
    const r = normalizeMetaApiEvent(e, { externalAccountId: "x", externalConversationId: "y" });
    expect(r.eventType).toBe("raw.whatsapp.foo");
  });
});
