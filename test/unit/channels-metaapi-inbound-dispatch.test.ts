import { describe, expect, it } from "vitest";

import {
  extractInboundMedia,
  extractInboundMessage,
  parseIgTimestamp,
} from "@/modules/channels/metaapi/inbound-dispatch.js";
import type { MetaApiEventEnvelope } from "@/modules/channels/metaapi/schemas.js";

// Smoke-reference parseIgTimestamp export contract (exercised indirectly
// via extractInboundMessage IG ISO case; direct reference here keeps
// import-symbol live for lint + future test additions).
describe("parseIgTimestamp — export contract", () => {
  it("is exported as a function", () => {
    expect(typeof parseIgTimestamp).toBe("function");
  });
});

const baseEnvelope: MetaApiEventEnvelope = {
  event_id: "0193e45a-c5e4-7000-a000-000000000001",
  event_type: "message.received",
  tenant_id: "0193e45a-c5e4-7000-a000-000000000010",
  occurred_at: "2026-05-20T12:00:00Z",
  data: {},
};

describe("extractInboundMessage — WhatsApp shape", () => {
  it("WA text message returns extracted shape", () => {
    const env: MetaApiEventEnvelope = {
      ...baseEnvelope,
      data: {
        messaging_product: "whatsapp",
        metadata: { phone_number_id: "wa_phone_xyz" },
        messages: [
          {
            id: "wamid.abc123",
            from: "5511999999999",
            timestamp: "1747746000",
            type: "text",
            text: { body: "olá" },
          },
        ],
        contacts: [{ wa_id: "5511999999999", profile: { name: "Cliente A" } }],
      },
    };
    const r = extractInboundMessage(env);
    expect(r).not.toBeNull();
    if (r === null) return;
    expect(r.externalMessageId).toBe("wamid.abc123");
    expect(r.contentText).toBe("olá");
    expect(r.direction).toBe("incoming");
    expect(r.messageCreatedAt).toBe(new Date(1747746000 * 1000).toISOString());
    expect(r.senderSnapshotJson).toEqual({
      wa_id: "5511999999999",
      profile: { name: "Cliente A" },
    });
  });

  it("WA image (no text) returns base shape with contentText null (media-only no longer dropped)", () => {
    const env: MetaApiEventEnvelope = {
      ...baseEnvelope,
      data: {
        messaging_product: "whatsapp",
        metadata: { phone_number_id: "wa_phone_xyz" },
        messages: [
          {
            id: "wamid.img",
            from: "5511",
            timestamp: "1747746000",
            type: "image",
            image: { id: "media_img_1", mime_type: "image/jpeg" },
          },
        ],
        contacts: [{ wa_id: "5511", profile: { name: "Cliente B" } }],
      },
    };
    const r = extractInboundMessage(env);
    expect(r).not.toBeNull();
    if (r === null) return;
    expect(r.externalMessageId).toBe("wamid.img");
    expect(r.contentText).toBeNull();
    expect(r.direction).toBe("incoming");
    expect(r.messageCreatedAt).toBe(new Date(1747746000 * 1000).toISOString());
    expect(r.senderSnapshotJson).toEqual({ wa_id: "5511", profile: { name: "Cliente B" } });
  });

  it("WA empty messages array returns null", () => {
    const env: MetaApiEventEnvelope = {
      ...baseEnvelope,
      data: {
        messaging_product: "whatsapp",
        metadata: { phone_number_id: "wa_phone_xyz" },
        messages: [],
      },
    };
    expect(extractInboundMessage(env)).toBeNull();
  });

  it("WA type=text but missing text.body returns base with contentText null", () => {
    const env: MetaApiEventEnvelope = {
      ...baseEnvelope,
      data: {
        messaging_product: "whatsapp",
        metadata: { phone_number_id: "wa_phone_xyz" },
        messages: [{ id: "wamid.x", from: "5511", timestamp: "1747746000", type: "text" }],
      },
    };
    const r = extractInboundMessage(env);
    expect(r).not.toBeNull();
    if (r === null) return;
    expect(r.externalMessageId).toBe("wamid.x");
    expect(r.contentText).toBeNull();
  });
});

describe("extractInboundMessage — Instagram shape", () => {
  it("IG text message com Unix-millis number timestamp returns extracted", () => {
    const env: MetaApiEventEnvelope = {
      ...baseEnvelope,
      data: {
        sender: { id: "ig_psid_abc" },
        recipient: { id: "ig_page_xyz" },
        timestamp: 1747746000000,
        message: { mid: "ig.mid.123", text: "oi" },
      },
    };
    const r = extractInboundMessage(env);
    expect(r).not.toBeNull();
    if (r === null) return;
    expect(r.externalMessageId).toBe("ig.mid.123");
    expect(r.contentText).toBe("oi");
    expect(r.direction).toBe("incoming");
    expect(r.senderSnapshotJson).toEqual({ id: "ig_psid_abc" });
  });

  it("IG ISO 8601 string timestamp parsed correctly (Agent #3 MEDIUM-3 fix)", () => {
    const env: MetaApiEventEnvelope = {
      ...baseEnvelope,
      data: {
        sender: { id: "ig_psid_abc" },
        recipient: { id: "ig_page_xyz" },
        timestamp: "2026-05-20T12:00:00Z",
        message: { mid: "ig.mid.iso", text: "ISO test" },
      },
    };
    const r = extractInboundMessage(env);
    expect(r).not.toBeNull();
    if (r === null) return;
    expect(r.messageCreatedAt).toBe("2026-05-20T12:00:00.000Z");
  });

  it("IG message without text returns base with contentText null (media-only no longer dropped)", () => {
    const env: MetaApiEventEnvelope = {
      ...baseEnvelope,
      data: {
        sender: { id: "ig_psid_abc" },
        recipient: { id: "ig_page_xyz" },
        timestamp: 1747746000000,
        message: { mid: "ig.mid.media" },
      },
    };
    const r = extractInboundMessage(env);
    expect(r).not.toBeNull();
    if (r === null) return;
    expect(r.externalMessageId).toBe("ig.mid.media");
    expect(r.contentText).toBeNull();
    expect(r.direction).toBe("incoming");
  });

  it("IG without sender.id returns null", () => {
    const env: MetaApiEventEnvelope = {
      ...baseEnvelope,
      data: {
        recipient: { id: "ig_page_xyz" },
        message: { mid: "ig.x", text: "missing sender" },
        timestamp: 1747746000000,
      },
    };
    expect(extractInboundMessage(env)).toBeNull();
  });
});

describe("extractInboundMessage — guards", () => {
  it("event_type !== 'message.received' returns null", () => {
    const env: MetaApiEventEnvelope = {
      ...baseEnvelope,
      event_type: "message.status_updated",
      data: { messaging_product: "whatsapp" },
    };
    expect(extractInboundMessage(env)).toBeNull();
  });

  it("envelope.data null returns null defensively", () => {
    const env: MetaApiEventEnvelope = {
      ...baseEnvelope,
      data: null,
    };
    expect(extractInboundMessage(env)).toBeNull();
  });
});

describe("extractInboundMedia — WhatsApp", () => {
  function waMediaEnvelope(type: string, mediaObj: Record<string, unknown>): MetaApiEventEnvelope {
    return {
      ...baseEnvelope,
      data: {
        messaging_product: "whatsapp",
        metadata: { phone_number_id: "wa_phone_xyz" },
        messages: [
          { id: `wamid.${type}`, from: "5511", timestamp: "1747746000", type, [type]: mediaObj },
        ],
      },
    };
  }

  it("WA image → media ref", () => {
    const env = waMediaEnvelope("image", {
      id: "media_img_1",
      mime_type: "image/jpeg",
      caption: "uma foto",
    });
    const r = extractInboundMedia(env);
    expect(r).toEqual([
      { media_key: "media_img_1", mime_type: "image/jpeg", filename: null, caption: "uma foto" },
    ]);
  });

  it("WA audio → media ref", () => {
    const env = waMediaEnvelope("audio", { id: "media_aud_1", mime_type: "audio/ogg" });
    expect(extractInboundMedia(env)).toEqual([
      { media_key: "media_aud_1", mime_type: "audio/ogg", filename: null, caption: null },
    ]);
  });

  it("WA document → media ref with filename", () => {
    const env = waMediaEnvelope("document", {
      id: "media_doc_1",
      mime_type: "application/pdf",
      filename: "fatura.pdf",
    });
    expect(extractInboundMedia(env)).toEqual([
      {
        media_key: "media_doc_1",
        mime_type: "application/pdf",
        filename: "fatura.pdf",
        caption: null,
      },
    ]);
  });

  it("WA video → media ref", () => {
    const env = waMediaEnvelope("video", { id: "media_vid_1", mime_type: "video/mp4" });
    expect(extractInboundMedia(env)).toEqual([
      { media_key: "media_vid_1", mime_type: "video/mp4", filename: null, caption: null },
    ]);
  });

  it("WA sticker → media ref", () => {
    const env = waMediaEnvelope("sticker", { id: "media_stk_1", mime_type: "image/webp" });
    expect(extractInboundMedia(env)).toEqual([
      { media_key: "media_stk_1", mime_type: "image/webp", filename: null, caption: null },
    ]);
  });

  it("WA media missing mime_type → falls back to application/octet-stream", () => {
    const env = waMediaEnvelope("image", { id: "media_img_nomime" });
    expect(extractInboundMedia(env)).toEqual([
      {
        media_key: "media_img_nomime",
        mime_type: "application/octet-stream",
        filename: null,
        caption: null,
      },
    ]);
  });

  it("WA media missing id → null", () => {
    const env = waMediaEnvelope("image", { mime_type: "image/jpeg" });
    expect(extractInboundMedia(env)).toBeNull();
  });

  it("WA text type → null (not media)", () => {
    const env: MetaApiEventEnvelope = {
      ...baseEnvelope,
      data: {
        messaging_product: "whatsapp",
        metadata: { phone_number_id: "wa_phone_xyz" },
        messages: [
          {
            id: "wamid.t",
            from: "5511",
            timestamp: "1747746000",
            type: "text",
            text: { body: "oi" },
          },
        ],
      },
    };
    expect(extractInboundMedia(env)).toBeNull();
  });

  it("WA empty messages → null", () => {
    const env: MetaApiEventEnvelope = {
      ...baseEnvelope,
      data: {
        messaging_product: "whatsapp",
        metadata: { phone_number_id: "wa_phone_xyz" },
        messages: [],
      },
    };
    expect(extractInboundMedia(env)).toBeNull();
  });

  it("IG shape → null (IG media deferred to P3d)", () => {
    const env: MetaApiEventEnvelope = {
      ...baseEnvelope,
      data: {
        sender: { id: "ig_psid_abc" },
        recipient: { id: "ig_page_xyz" },
        timestamp: 1747746000000,
        message: { mid: "ig.mid.media", attachments: [{ type: "image" }] },
      },
    };
    expect(extractInboundMedia(env)).toBeNull();
  });

  it("non-message.received event → null", () => {
    const env: MetaApiEventEnvelope = {
      ...baseEnvelope,
      event_type: "message.status_updated",
      data: { messaging_product: "whatsapp" },
    };
    expect(extractInboundMedia(env)).toBeNull();
  });

  it("envelope.data null → null defensively", () => {
    const env: MetaApiEventEnvelope = { ...baseEnvelope, data: null };
    expect(extractInboundMedia(env)).toBeNull();
  });
});
