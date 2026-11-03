import { describe, expect, it } from "vitest";

import {
  metaApiEventEnvelopeSchema,
  metaApiVerificationChallengeSchema,
  CANONICAL_EVENT_TYPES,
} from "@/modules/channels/metaapi/schemas.js";

describe("metaApiEventEnvelopeSchema", () => {
  const valid = {
    event_id: "0193e45a-c5e4-7000-9000-000000000001",
    event_type: "message.received",
    tenant_id: "0193e45a-c5e4-7000-9000-000000000002",
    occurred_at: "2026-05-20T14:00:07.906Z",
    data: { messaging_product: "whatsapp", from: "5511999999999" },
  };

  it("parses a valid envelope (WA message.received)", () => {
    const r = metaApiEventEnvelopeSchema.parse(valid);
    expect(r.event_id).toBe(valid.event_id);
    expect(r.event_type).toBe("message.received");
  });

  it("accepts tenant_id null (global subscription delivery)", () => {
    metaApiEventEnvelopeSchema.parse({ ...valid, tenant_id: null });
  });

  it("rejects unknown event_type outside canonical + raw.*", () => {
    expect(() =>
      metaApiEventEnvelopeSchema.parse({ ...valid, event_type: "unknown.thing" }),
    ).toThrow();
  });

  it("accepts raw.* fallback event_type", () => {
    metaApiEventEnvelopeSchema.parse({ ...valid, event_type: "raw.whatsapp.foo" });
  });

  it("rejects malformed event_id (non-UUIDv7)", () => {
    expect(() => metaApiEventEnvelopeSchema.parse({ ...valid, event_id: "not-a-uuid" })).toThrow();
  });
});

describe("metaApiVerificationChallengeSchema", () => {
  it("parses a valid challenge body", () => {
    const r = metaApiVerificationChallengeSchema.parse({
      verification_challenge: "abc123",
    });
    expect(r.verification_challenge).toBe("abc123");
  });
});

describe("CANONICAL_EVENT_TYPES", () => {
  it("includes all 5 canonical types per spec §4", () => {
    expect(CANONICAL_EVENT_TYPES).toEqual([
      "message.received",
      "message.status_updated",
      "template.status_updated",
      "phone_number.quality_changed",
      "waba.connection_changed",
    ]);
  });
});
