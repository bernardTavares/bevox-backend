import { describe, it, expect, vi } from "vitest";
import Fastify from "fastify";
import idempotency from "@/plugins/idempotency.js";

/**
 * In-memory Redis stub — only the surface idempotency.ts touches:
 * get / set (with EX). No live Redis required for the unit test.
 */
function makeFakeRedis() {
  const store = new Map<string, string>();
  return {
    get: vi.fn(async (k: string) => store.get(k) ?? null),
    set: vi.fn(async (k: string, v: string) => {
      store.set(k, v);
      return "OK";
    }),
  };
}

describe("idempotency plugin (ADR-015)", () => {
  it("replays cached response on a second identical POST WITHOUT re-running the handler", async () => {
    const app = Fastify();
    const fakeRedis = makeFakeRedis();
    // App-level decorator override seam honored by the plugin for tests.
    app.decorate("__idempotencyRedis", fakeRedis);
    await app.register(idempotency);

    const handler = vi.fn(async () => ({ value: Math.random() }));
    app.post("/api/v1/m", { preHandler: [app.requireIdempotency()] }, handler);

    const headers = { "idempotency-key": "key-abc-123" };

    const first = await app.inject({
      method: "POST",
      url: "/api/v1/m",
      headers,
      payload: { a: 1 },
    });
    expect(first.statusCode).toBe(200);
    const firstBody = first.json();

    const second = await app.inject({
      method: "POST",
      url: "/api/v1/m",
      headers,
      payload: { a: 1 },
    });
    expect(second.statusCode).toBe(200);
    expect(second.json()).toEqual(firstBody);

    // Handler ran exactly once — second request was served from cache.
    expect(handler).toHaveBeenCalledTimes(1);
    await app.close();
  });

  it("runs the handler when no Idempotency-Key cache hit exists", async () => {
    const app = Fastify();
    const fakeRedis = makeFakeRedis();
    app.decorate("__idempotencyRedis", fakeRedis);
    await app.register(idempotency);

    const handler = vi.fn(async () => ({ ok: true }));
    app.post("/api/v1/m", { preHandler: [app.requireIdempotency()] }, handler);

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/m",
      headers: { "idempotency-key": "fresh-key" },
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    expect(handler).toHaveBeenCalledTimes(1);
    // SET idempotency:{key} ... EX 86400 was issued.
    expect(fakeRedis.set).toHaveBeenCalled();
    const setCall = fakeRedis.set.mock.calls[0];
    expect(setCall?.[0]).toBe("idempotency:fresh-key");
    expect(setCall).toContain(86400);
    await app.close();
  });
});
