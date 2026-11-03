import { describe, expect, it, beforeEach } from "vitest";

import {
  setMetaApiFetchForTests,
  resetMetaApiFetchForTests,
  bootstrapSubscription,
} from "@/modules/channels/metaapi/subscription-bootstrap.js";

const FAKE_SUB = {
  id: "0193e45a-c5e4-7000-9000-000000000010",
  app_id: "0193e45a-c5e4-7000-9000-000000000001",
  url: "https://backend.example.com/api/v1/webhooks/metaapi/events",
  signing_secret: "sub_secret_abc123",
  status: "active",
};

beforeEach(() => {
  resetMetaApiFetchForTests();
  process.env.NODE_ENV = "test";
});

describe("bootstrapSubscription", () => {
  it("creates a new subscription if none exists for url", async () => {
    setMetaApiFetchForTests(async (path, opts) => {
      if (opts.method === "POST" && path === "/v1/webhooks/subscriptions") {
        return new Response(JSON.stringify(FAKE_SUB), { status: 201 });
      }
      throw new Error(`unexpected ${opts.method} ${path}`);
    });

    const persistedSecrets: string[] = [];
    const r = await bootstrapSubscription({
      url: FAKE_SUB.url,
      eventTypesFilter: ["message.received"],
      persistSubscription: async (s) => {
        persistedSecrets.push(s.signingSecretPlaintext);
      },
      findExistingByUrl: async () => null,
    });

    expect(r.created).toBe(true);
    expect(r.subscriptionId).toBe(FAKE_SUB.id);
    expect(persistedSecrets).toEqual([FAKE_SUB.signing_secret]);
  });

  it("no-op if subscription already exists for url (local DB row)", async () => {
    setMetaApiFetchForTests(async () => {
      throw new Error("should not call meta-api when local row exists");
    });

    const r = await bootstrapSubscription({
      url: FAKE_SUB.url,
      eventTypesFilter: ["message.received"],
      persistSubscription: async () => {
        throw new Error("should not persist");
      },
      findExistingByUrl: async () => ({
        subscriptionId: FAKE_SUB.id,
        status: "active" as const,
      }),
    });

    expect(r.created).toBe(false);
    expect(r.subscriptionId).toBe(FAKE_SUB.id);
  });

  it("uses stable Idempotency-Key per environment", async () => {
    let capturedKey: string | undefined;
    setMetaApiFetchForTests(async (_path, opts) => {
      capturedKey = opts.headers?.["Idempotency-Key"];
      return new Response(JSON.stringify(FAKE_SUB), { status: 201 });
    });

    await bootstrapSubscription({
      url: FAKE_SUB.url,
      eventTypesFilter: ["message.received"],
      persistSubscription: async () => {},
      findExistingByUrl: async () => null,
    });

    expect(capturedKey).toBe("sub-test-bootstrap");
  });

  it("subscribes ALL 5 canonical event_types when caller passes them", async () => {
    let capturedBody: string | undefined;
    setMetaApiFetchForTests(async (_path, opts) => {
      capturedBody = opts.body;
      return new Response(JSON.stringify(FAKE_SUB), { status: 201 });
    });

    await bootstrapSubscription({
      url: FAKE_SUB.url,
      eventTypesFilter: [
        "message.received",
        "message.status_updated",
        "template.status_updated",
        "phone_number.quality_changed",
        "waba.connection_changed",
      ],
      persistSubscription: async () => {},
      findExistingByUrl: async () => null,
    });

    const parsed = JSON.parse(capturedBody!);
    expect(parsed.event_types_filter).toHaveLength(5);
    expect(parsed.delivery_mode).toBe("push");
    expect(parsed.tenant_id).toBeUndefined();
  });

  it("propagates meta-api 4xx errors", async () => {
    setMetaApiFetchForTests(async () => {
      return new Response(JSON.stringify({ code: "INVALID_INPUT", message: "bad url" }), {
        status: 400,
      });
    });

    await expect(
      bootstrapSubscription({
        url: "invalid",
        eventTypesFilter: ["message.received"],
        persistSubscription: async () => {},
        findExistingByUrl: async () => null,
      }),
    ).rejects.toThrow(/INVALID_INPUT|bad url|400/i);
  });
});
