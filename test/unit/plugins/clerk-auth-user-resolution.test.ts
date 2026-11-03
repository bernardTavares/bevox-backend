/**
 * Unit test — clerk-auth local user resolution seam (POC).
 *
 * Finding: `clerk-auth-no-local-user-resolution` (HIGH).
 *
 * Cobre:
 *   - JWT válido (test seam) + `users` row existe → `req.user` populado
 *     com `{ id, organization_id, role, email, name }`.
 *   - JWT válido + sem row local → `req.user === null` (gracioso, NÃO 401).
 *   - `req.auth` (JWT claims) permanece inalterado em ambos os casos.
 *   - Falha de DB no seam não derruba a request (fail-open, `req.user = null`).
 *
 * `findUserByClerkUserId` é mockado via `vi.mock` — não precisa Postgres
 * nem Redis. Usa o test seam `NODE_ENV=test` + header
 * `x-test-clerk-organization` (mesma escotilha do plugin
 * organization-scope).
 *
 * Out-of-scope (follow-up PR): enforcement de RBAC em rota
 * (`requireRole(roles)`) + sanitização do `role` claim contra o enum
 * postgres `user_role` (owner|admin|operator|professional_viewer).
 */

import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { LocalUserRow } from "@/modules/auth/repository.js";

// Mock antes de import dinâmico do plugin — o plugin importa este símbolo
// no top-level. `findUserByClerkUserId` é a única superfície que o seam
// usa de `@/modules/auth/repository`; manter os demais reais não é
// necessário (o plugin não os referencia em runtime).
const findUserByClerkUserIdMock = vi.fn<(clerkUserId: string) => Promise<LocalUserRow | null>>();

vi.mock("@/modules/auth/repository.js", () => ({
  findUserByClerkUserId: (clerkUserId: string) => findUserByClerkUserIdMock(clerkUserId),
}));

const TEST_ORG_ID = "00000000-0000-7000-8000-000000000abc";
const LOCAL_USER_ID = "00000000-0000-7000-8000-000000000def";

const LOCAL_USER: LocalUserRow = {
  id: LOCAL_USER_ID,
  organization_id: TEST_ORG_ID,
  role: "operator",
  email: "u@example.com",
  name: "Test User",
};

beforeEach(() => {
  findUserByClerkUserIdMock.mockReset();
  process.env.NODE_ENV = "test";
  process.env.TEST_AUTH_BYPASS_ENABLED = "true";
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("clerk-auth local user resolution seam (POC)", () => {
  it("populates req.user when a local users row exists for clerk_user_id", async () => {
    findUserByClerkUserIdMock.mockResolvedValue(LOCAL_USER);

    const { default: clerkAuth } = await import("@/plugins/clerk-auth.js");

    const app = Fastify({ logger: false });
    await app.register(clerkAuth);
    app.get("/whoami", { preHandler: [app.requireClerkAuth()] }, async (req) => ({
      auth: req.auth,
      user: req.user,
    }));

    const res = await app.inject({
      method: "GET",
      url: "/whoami",
      headers: { "x-test-clerk-organization": TEST_ORG_ID },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { auth: unknown; user: unknown };
    // req.auth (JWT claims) intacto — POC NÃO altera o envelope canônico.
    expect(body.auth).toEqual({
      clerk_user_id: "test_clerk_user",
      organization_id: TEST_ORG_ID,
      role: "member",
    });
    // req.user resolvido via seam.
    expect(body.user).toEqual(LOCAL_USER);
    expect(findUserByClerkUserIdMock).toHaveBeenCalledOnce();
    expect(findUserByClerkUserIdMock).toHaveBeenCalledWith("test_clerk_user");

    await app.close();
  });

  it("sets req.user to null gracefully when no local row exists (webhook lag / not provisioned)", async () => {
    findUserByClerkUserIdMock.mockResolvedValue(null);

    const { default: clerkAuth } = await import("@/plugins/clerk-auth.js");

    const app = Fastify({ logger: false });
    await app.register(clerkAuth);
    app.get("/whoami", { preHandler: [app.requireClerkAuth()] }, async (req) => ({
      auth: req.auth,
      user: req.user,
    }));

    const res = await app.inject({
      method: "GET",
      url: "/whoami",
      headers: { "x-test-clerk-organization": TEST_ORG_ID },
    });

    // 200 — gracioso. Sem row local NÃO é 401: o token Clerk é válido.
    expect(res.statusCode).toBe(200);
    const body = res.json() as { auth: unknown; user: unknown };
    expect(body.auth).toEqual({
      clerk_user_id: "test_clerk_user",
      organization_id: TEST_ORG_ID,
      role: "member",
    });
    expect(body.user).toBeNull();

    await app.close();
  });

  it("fails open (req.user = null) when the seam query throws — does NOT 500", async () => {
    findUserByClerkUserIdMock.mockRejectedValue(new Error("db down"));

    const { default: clerkAuth } = await import("@/plugins/clerk-auth.js");

    const app = Fastify({ logger: false });
    await app.register(clerkAuth);
    app.get("/whoami", { preHandler: [app.requireClerkAuth()] }, async (req) => ({
      auth: req.auth,
      user: req.user,
    }));

    const res = await app.inject({
      method: "GET",
      url: "/whoami",
      headers: { "x-test-clerk-organization": TEST_ORG_ID },
    });

    // Fail-open: o seam é puramente aditivo; outage de DB não pode 500
    // requests que já carregam JWT Clerk válido.
    expect(res.statusCode).toBe(200);
    const body = res.json() as { auth: unknown; user: unknown };
    expect(body.user).toBeNull();
    expect(body.auth).toEqual({
      clerk_user_id: "test_clerk_user",
      organization_id: TEST_ORG_ID,
      role: "member",
    });

    await app.close();
  });
});
