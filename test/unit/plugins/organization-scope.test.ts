import { afterEach, beforeEach, describe, it, expect } from "vitest";
import Fastify from "fastify";
import organizationScope from "@/plugins/organization-scope.js";

/**
 * Test seam contract: the `x-test-claim-organization` header is honored
 * ONLY when the explicit feature flag `TEST_AUTH_BYPASS_ENABLED=true`
 * is set. NODE_ENV=test alone (the default for vitest) is NOT sufficient
 * — finding `test-seam-auth-bypass-on-nodeenv-test`.
 */
describe("organization-scope guard", () => {
  const originalFlag = process.env.TEST_AUTH_BYPASS_ENABLED;

  beforeEach(() => {
    // Each test sets the flag explicitly so coverage is deliberate.
    delete process.env.TEST_AUTH_BYPASS_ENABLED;
  });

  afterEach(() => {
    if (originalFlag === undefined) {
      delete process.env.TEST_AUTH_BYPASS_ENABLED;
    } else {
      process.env.TEST_AUTH_BYPASS_ENABLED = originalFlag;
    }
  });

  it("403 when path :organization_id != token claim (flag enabled)", async () => {
    process.env.TEST_AUTH_BYPASS_ENABLED = "true";
    const app = Fastify();
    await app.register(organizationScope);
    app.get(
      "/api/v1/organizations/:organization_id/x",
      { preHandler: [app.requireOrganizationScope()] },
      async () => ({ ok: true }),
    );
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/organizations/00000000-0000-7000-8000-000000000001/x",
      headers: { "x-test-claim-organization": "00000000-0000-7000-8000-000000000002" },
    });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it("200 + decorates request.organizationId when path :organization_id == token claim (flag enabled)", async () => {
    process.env.TEST_AUTH_BYPASS_ENABLED = "true";
    const app = Fastify();
    await app.register(organizationScope);
    app.get(
      "/api/v1/organizations/:organization_id/x",
      { preHandler: [app.requireOrganizationScope()] },
      async (req) => ({ org: req.organizationId }),
    );
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/organizations/00000000-0000-7000-8000-000000000001/x",
      headers: { "x-test-claim-organization": "00000000-0000-7000-8000-000000000001" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ org: "00000000-0000-7000-8000-000000000001" });
    await app.close();
  });

  it("401 when no authenticated principal is present", async () => {
    process.env.TEST_AUTH_BYPASS_ENABLED = "true";
    const app = Fastify();
    await app.register(organizationScope);
    app.get(
      "/api/v1/organizations/:organization_id/x",
      { preHandler: [app.requireOrganizationScope()] },
      async () => ({ ok: true }),
    );
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/organizations/00000000-0000-7000-8000-000000000001/x",
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  // Defense-in-depth: with the flag unset, the header MUST be ignored,
  // even when NODE_ENV=test (vitest default). The plugin must respond
  // 401 UNAUTHENTICATED — never inject a synthetic principal.
  it("401 when flag is UNSET, even with x-test-claim-organization header set", async () => {
    // Vitest runs with NODE_ENV=test by default; the flag is deleted in beforeEach.
    expect(process.env.TEST_AUTH_BYPASS_ENABLED).toBeUndefined();
    const app = Fastify();
    await app.register(organizationScope);
    app.get(
      "/api/v1/organizations/:organization_id/x",
      { preHandler: [app.requireOrganizationScope()] },
      async () => ({ ok: true }),
    );
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/organizations/00000000-0000-7000-8000-000000000001/x",
      headers: { "x-test-claim-organization": "00000000-0000-7000-8000-000000000001" },
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it("401 when flag is explicitly set to 'false', even with header set", async () => {
    process.env.TEST_AUTH_BYPASS_ENABLED = "false";
    const app = Fastify();
    await app.register(organizationScope);
    app.get(
      "/api/v1/organizations/:organization_id/x",
      { preHandler: [app.requireOrganizationScope()] },
      async () => ({ ok: true }),
    );
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/organizations/00000000-0000-7000-8000-000000000001/x",
      headers: { "x-test-claim-organization": "00000000-0000-7000-8000-000000000001" },
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  // Truthy aliases: the flag parser accepts "true", "1", "yes" (lowercased).
  it.each([
    ["1", 200],
    ["yes", 200],
    ["TRUE", 200],
    ["", 401],
    ["0", 401],
    ["no", 401],
    ["enabled", 401],
  ])("flag=%j yields HTTP %i", async (flagValue, expectedStatus) => {
    process.env.TEST_AUTH_BYPASS_ENABLED = flagValue;
    const app = Fastify();
    await app.register(organizationScope);
    app.get(
      "/api/v1/organizations/:organization_id/x",
      { preHandler: [app.requireOrganizationScope()] },
      async () => ({ ok: true }),
    );
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/organizations/00000000-0000-7000-8000-000000000001/x",
      headers: { "x-test-claim-organization": "00000000-0000-7000-8000-000000000001" },
    });
    expect(res.statusCode).toBe(expectedStatus);
    await app.close();
  });
});
