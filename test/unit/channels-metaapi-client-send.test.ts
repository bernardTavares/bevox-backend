import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { generateKeyPairSync } from "node:crypto";

import { sendMessage } from "@/modules/channels/metaapi/client.js";
import type { MetaApiSendBody } from "@/modules/channels/metaapi/send-message-intent.js";

const { privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});

const baseBody: MetaApiSendBody = {
  channel: "whatsapp",
  to: "5511999999999",
  type: "text",
  content: { body: "hi" },
};

beforeAll(() => {
  process.env.META_API_APP_ID = "0193e45a-c5e4-7000-9000-000000000001";
  process.env.META_API_KEY_ID = "0193e45a-c5e4-7000-9000-000000000002";
  process.env.META_API_PRIVATE_KEY_PEM = privateKey;
  process.env.META_API_BASE_URL = "http://meta-api.test";
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("client.sendMessage", () => {
  it("returns 'sent' on HTTP 200 body.status='sent'", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          message_id: "msg_1",
          provider_message_id: "wamid.abc",
          channel: "whatsapp",
          status: "sent",
        }),
        { status: 200 },
      ),
    );
    const r = await sendMessage({
      metaApiTenantId: "0193e45a-c5e4-7000-9000-000000000099",
      body: baseBody,
      idempotencyKey: "delivery:exec1",
    });
    expect(r.status).toBe("sent");
    if (r.status !== "sent") return;
    expect(r.message_id).toBe("msg_1");
    expect(r.provider_message_id).toBe("wamid.abc");
    expect(r.channel).toBe("whatsapp");
  });

  it("maps HTTP 200 body.status='failed' to error envelope", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          message_id: "msg_2",
          provider_message_id: "",
          channel: "whatsapp",
          status: "failed",
          error: { code: "META_REJECTED", message: "template not approved" },
        }),
        { status: 200 },
      ),
    );
    const r = await sendMessage({
      metaApiTenantId: "0193e45a-c5e4-7000-9000-000000000099",
      body: baseBody,
      idempotencyKey: "delivery:exec2",
    });
    expect(r.status).toBe("error");
    if (r.status !== "error") return;
    expect(r.code).toBe("META_REJECTED");
  });

  it("maps HTTP 502 META_UNAVAILABLE", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: { code: "META_UNAVAILABLE", message: "Meta down" } }), {
        status: 502,
      }),
    );
    const r = await sendMessage({
      metaApiTenantId: "0193e45a-c5e4-7000-9000-000000000099",
      body: baseBody,
      idempotencyKey: "delivery:exec3",
    });
    expect(r.status).toBe("error");
    if (r.status !== "error") return;
    expect(r.code).toBe("META_UNAVAILABLE");
  });

  it("maps HTTP 422 META_REJECTED", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: { code: "META_REJECTED", message: "rejected" } }), {
        status: 422,
      }),
    );
    const r = await sendMessage({
      metaApiTenantId: "0193e45a-c5e4-7000-9000-000000000099",
      body: baseBody,
      idempotencyKey: "delivery:exec4",
    });
    expect(r.status).toBe("error");
    if (r.status !== "error") return;
    expect(r.code).toBe("META_REJECTED");
  });

  it("maps HTTP 409 IDEMPOTENCY_CONFLICT", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({ error: { code: "IDEMPOTENCY_CONFLICT", message: "key mismatch" } }),
        { status: 409 },
      ),
    );
    const r = await sendMessage({
      metaApiTenantId: "0193e45a-c5e4-7000-9000-000000000099",
      body: baseBody,
      idempotencyKey: "delivery:exec5",
    });
    expect(r.status).toBe("error");
    if (r.status !== "error") return;
    expect(r.code).toBe("IDEMPOTENCY_CONFLICT");
  });

  it("maps HTTP 500 INTERNAL (IG task #20 case)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: { code: "INTERNAL", message: "Instagram task #20" } }), {
        status: 500,
      }),
    );
    const r = await sendMessage({
      metaApiTenantId: "0193e45a-c5e4-7000-9000-000000000099",
      body: { ...baseBody, channel: "instagram", to: "ig_psid_abc" },
      idempotencyKey: "delivery:exec6",
    });
    expect(r.status).toBe("error");
    if (r.status !== "error") return;
    expect(r.code).toBe("INTERNAL");
  });

  it("maps HTTP 401 UNAUTHENTICATED + 403 FORBIDDEN + 404 NOT_FOUND", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { code: "UNAUTHENTICATED", message: "bad jwt" } }), {
        status: 401,
      }),
    );
    const r401 = await sendMessage({
      metaApiTenantId: "0193e45a-c5e4-7000-9000-000000000099",
      body: baseBody,
      idempotencyKey: "delivery:exec7",
    });
    expect(r401.status === "error" && r401.code).toBe("UNAUTHENTICATED");

    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { code: "FORBIDDEN", message: "scope" } }), {
        status: 403,
      }),
    );
    const r403 = await sendMessage({
      metaApiTenantId: "0193e45a-c5e4-7000-9000-000000000099",
      body: baseBody,
      idempotencyKey: "delivery:exec8",
    });
    expect(r403.status === "error" && r403.code).toBe("FORBIDDEN");

    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { code: "NOT_FOUND", message: "tenant" } }), {
        status: 404,
      }),
    );
    const r404 = await sendMessage({
      metaApiTenantId: "0193e45a-c5e4-7000-9000-000000000099",
      body: baseBody,
      idempotencyKey: "delivery:exec9",
    });
    expect(r404.status === "error" && r404.code).toBe("NOT_FOUND");
  });

  it("falls back to UNKNOWN on unparseable response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("not json", { status: 503 }));
    const r = await sendMessage({
      metaApiTenantId: "0193e45a-c5e4-7000-9000-000000000099",
      body: baseBody,
      idempotencyKey: "delivery:exec10",
    });
    expect(r.status).toBe("error");
    if (r.status !== "error") return;
    expect(r.code).toBe("UNKNOWN");
  });
});
