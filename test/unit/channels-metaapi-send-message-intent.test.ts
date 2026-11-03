import { describe, expect, it } from "vitest";

import {
  validateAndBuild,
  buildIdempotencyKey,
  type SendMessageInput,
} from "@/modules/channels/metaapi/send-message-intent.js";

const baseInput: SendMessageInput = {
  channel: "whatsapp",
  to: "5511999999999",
  from: "wa_phone_id_xyz",
  responseText: "Olá, tudo bem?",
  executionId: "0193e45a-c5e4-7000-9000-000000000001",
};

describe("buildIdempotencyKey", () => {
  it("synth delivery:${executionId} format", () => {
    expect(buildIdempotencyKey(baseInput.executionId)).toBe(`delivery:${baseInput.executionId}`);
  });

  it("fits meta-api regex [A-Za-z0-9._\\-:/=+]{1,128}", () => {
    const key = buildIdempotencyKey(baseInput.executionId);
    expect(key).toMatch(/^[A-Za-z0-9._\-:/=+]{1,128}$/);
    expect(key.length).toBeLessThanOrEqual(128);
  });
});

describe("validateAndBuild — happy paths", () => {
  it("builds valid WhatsApp text payload", () => {
    const r = validateAndBuild(baseInput);
    expect(r.kind).toBe("ok");
    if (r.kind !== "ok") return;
    expect(r.payload.channel).toBe("whatsapp");
    expect(r.payload.to).toBe("5511999999999");
    expect(r.payload.from).toBe("wa_phone_id_xyz");
    expect(r.payload.type).toBe("text");
    expect(r.payload.content.body).toBe("Olá, tudo bem?");
    expect(r.idempotencyKey).toBe(`delivery:${baseInput.executionId}`);
  });

  it("builds Instagram text payload (channel='instagram')", () => {
    const r = validateAndBuild({ ...baseInput, channel: "instagram", to: "ig_user_psid_abc" });
    expect(r.kind).toBe("ok");
    if (r.kind !== "ok") return;
    expect(r.payload.channel).toBe("instagram");
    expect(r.payload.to).toBe("ig_user_psid_abc");
  });

  it("omits `from` when not provided", () => {
    const { from: _unused, ...without } = baseInput;
    void _unused;
    const r = validateAndBuild(without);
    expect(r.kind).toBe("ok");
    if (r.kind !== "ok") return;
    expect(r.payload.from).toBeUndefined();
  });

  it("preserves multi-line body", () => {
    const multi = "linha 1\nlinha 2\nlinha 3";
    const r = validateAndBuild({ ...baseInput, responseText: multi });
    expect(r.kind).toBe("ok");
    if (r.kind !== "ok") return;
    expect(r.payload.content.body).toBe(multi);
  });

  it("accepts body exactly 4096 chars (meta-api WA limit)", () => {
    const body = "a".repeat(4096);
    const r = validateAndBuild({ ...baseInput, responseText: body });
    expect(r.kind).toBe("ok");
  });
});

describe("validateAndBuild — skip paths", () => {
  it("skips empty responseText", () => {
    const r = validateAndBuild({ ...baseInput, responseText: "" });
    expect(r.kind).toBe("skip");
    if (r.kind !== "skip") return;
    expect(r.reason).toBe("empty_text");
  });

  it("skips whitespace-only responseText", () => {
    const r = validateAndBuild({ ...baseInput, responseText: "   \n\t  " });
    expect(r.kind).toBe("skip");
    if (r.kind !== "skip") return;
    expect(r.reason).toBe("empty_text");
  });

  it("skips empty to (missing recipient)", () => {
    const r = validateAndBuild({ ...baseInput, to: "" });
    expect(r.kind).toBe("skip");
    if (r.kind !== "skip") return;
    expect(r.reason).toBe("missing_recipient");
  });

  it("skips whitespace-only to", () => {
    const r = validateAndBuild({ ...baseInput, to: "  " });
    expect(r.kind).toBe("skip");
    if (r.kind !== "skip") return;
    expect(r.reason).toBe("missing_recipient");
  });
});

describe("validateAndBuild — body trim", () => {
  it("trims leading/trailing whitespace from responseText", () => {
    const r = validateAndBuild({ ...baseInput, responseText: "   hello   " });
    expect(r.kind).toBe("ok");
    if (r.kind !== "ok") return;
    expect(r.payload.content.body).toBe("hello");
  });
});
