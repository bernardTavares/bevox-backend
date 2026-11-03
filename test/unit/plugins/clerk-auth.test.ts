import { afterEach, beforeEach, describe, it, expect } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import clerkAuth from "@/plugins/clerk-auth.js";
import { errorHandler } from "@/bootstrap/error-handler.js";

/**
 * Builds a Fastify app with the canonical error handler registered so that
 * `AppError` (thrown by `requireClerkAuth()`) is converted into the
 * canonical JSON shape with the right HTTP status (401 for
 * UNAUTHENTICATED). Without this, Fastify would treat the unhandled
 * AppError as a generic 500.
 */
async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify();
  app.setErrorHandler(errorHandler);
  await app.register(clerkAuth);
  return app;
}

/**
 * Test seam contract: the `x-test-clerk-organization` header is honored
 * ONLY when the explicit feature flag `TEST_AUTH_BYPASS_ENABLED=true`
 * is set. NODE_ENV=test alone (the default for vitest) is NOT sufficient
 * — finding `test-seam-auth-bypass-on-nodeenv-test`.
 *
 * When the flag is unset (or false), the preHandler MUST require a
 * Bearer token (401 without one) — the synthetic principal injection
 * is unreachable, even with the header present.
 */
describe("clerk-auth preHandler — test-seam guard", () => {
  const originalFlag = process.env.TEST_AUTH_BYPASS_ENABLED;

  beforeEach(() => {
    delete process.env.TEST_AUTH_BYPASS_ENABLED;
  });

  afterEach(() => {
    if (originalFlag === undefined) {
      delete process.env.TEST_AUTH_BYPASS_ENABLED;
    } else {
      process.env.TEST_AUTH_BYPASS_ENABLED = originalFlag;
    }
  });

  it("with flag enabled + header → injects synthetic principal", async () => {
    process.env.TEST_AUTH_BYPASS_ENABLED = "true";
    const app = await buildApp();
    app.get("/x", { preHandler: [app.requireClerkAuth()] }, async (req) => ({
      org: req.auth?.organization_id,
      user: req.auth?.clerk_user_id,
      role: req.auth?.role,
    }));
    const res = await app.inject({
      method: "GET",
      url: "/x",
      headers: { "x-test-clerk-organization": "00000000-0000-7000-8000-000000000123" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      org: "00000000-0000-7000-8000-000000000123",
      user: "test_clerk_user",
      role: "member",
    });
    await app.close();
  });

  it("with flag UNSET + header → 401 (header is ignored)", async () => {
    // Vitest default NODE_ENV=test; flag deleted in beforeEach.
    expect(process.env.TEST_AUTH_BYPASS_ENABLED).toBeUndefined();
    const app = await buildApp();
    app.get("/x", { preHandler: [app.requireClerkAuth()] }, async () => ({ ok: true }));
    const res = await app.inject({
      method: "GET",
      url: "/x",
      headers: { "x-test-clerk-organization": "00000000-0000-7000-8000-000000000123" },
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it("with flag explicitly 'false' + header → 401", async () => {
    process.env.TEST_AUTH_BYPASS_ENABLED = "false";
    const app = await buildApp();
    app.get("/x", { preHandler: [app.requireClerkAuth()] }, async () => ({ ok: true }));
    const res = await app.inject({
      method: "GET",
      url: "/x",
      headers: { "x-test-clerk-organization": "00000000-0000-7000-8000-000000000123" },
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it("with flag enabled but no header → falls through to Bearer requirement → 401", async () => {
    process.env.TEST_AUTH_BYPASS_ENABLED = "true";
    const app = await buildApp();
    app.get("/x", { preHandler: [app.requireClerkAuth()] }, async () => ({ ok: true }));
    const res = await app.inject({
      method: "GET",
      url: "/x",
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });
});
