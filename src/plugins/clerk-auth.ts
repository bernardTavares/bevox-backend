/**
 * Plugin Fastify — autenticação Clerk de usuários do produto (ADR-013).
 *
 * Verifica o JWT Clerk via JWKS remoto:
 *   - `jose` `createRemoteJWKSet(new URL(CLERK_JWKS_URL))`.
 *   - Algoritmo: APENAS RS256 (proteção contra `alg:none`/HS256 confusion).
 *   - Claims → `request.auth = { clerk_user_id, organization_id, role }`.
 *
 * Tenant identity = organizationId (canon _shared/ADR-021, accepted,
 * supersedes hub-ADR-003). The harness is organization_id-native
 * (ADR-019); the resolveOrganizationId bridge was collapsed (SP-3 Phase
 * 2). The legacy tenant token is retired — it appears nowhere.
 * `organization_id` é a identidade canônica de tenant — lido SEMPRE do
 * claim do principal autenticado, NUNCA do body.
 *
 * Local-user resolution seam (POC, finding
 * `clerk-auth-no-local-user-resolution`): após verificar o JWT, o
 * preHandler tenta resolver a row local em `users` pelo
 * `clerk_user_id` e popula `req.user` com
 * `{ id, organization_id, role, email, name }` (ou null se o usuário
 * ainda não foi provisionado por webhook). `req.auth` permanece
 * intocado — é o envelope canônico do principal. Esta resolução é
 * PURAMENTE ADITIVA: nenhuma rota enforce RBAC com `req.user` neste
 * PR. Follow-up: sanitizar `role` ao enum `user_role` e prover
 * `requireRole(roles)` middleware.
 *
 * Decora `request.auth` e `request.user`. Expõe `app.requireClerkAuth()`
 * (preHandler 401).
 */

import fp from "fastify-plugin";
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import type {
  FastifyBaseLogger,
  FastifyInstance,
  FastifyPluginAsync,
  preHandlerHookHandler,
} from "fastify";

import { env } from "@/config/env.js";
import { findUserByClerkUserId, type LocalUserRow } from "@/modules/auth/repository.js";
import { errors } from "@/shared/errors.js";

interface ClerkAuth {
  clerk_user_id: string;
  organization_id: string;
  role: string;
}

/**
 * Reads the TEST_AUTH_BYPASS_ENABLED flag directly from process.env. This
 * intentionally bypasses the cached `env()` because the seam must work in
 * isolated unit tests that do not configure DATABASE_URL/REDIS_URL. The
 * env schema (src/config/env.ts) is still the source of truth: it parses
 * the same variable and REJECTS truthy values when NODE_ENV=production,
 * so a production deploy can never reach the seam branch.
 */
function isTestAuthBypassEnabled(): boolean {
  const raw = process.env.TEST_AUTH_BYPASS_ENABLED;
  if (typeof raw !== "string") return false;
  const v = raw.trim().toLowerCase();
  return v === "true" || v === "1" || v === "yes";
}

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

function getJwks(): ReturnType<typeof createRemoteJWKSet> {
  if (jwks === null) {
    const cfg = env();
    if (!cfg.CLERK_JWKS_URL) {
      throw errors.internal("CLERK_JWKS_URL is not configured");
    }
    jwks = createRemoteJWKSet(new URL(cfg.CLERK_JWKS_URL));
  }
  return jwks;
}

function claimAsString(payload: JWTPayload, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const val = payload[key];
    if (typeof val === "string" && val.length > 0) return val;
  }
  return undefined;
}

export async function verifyClerkJwt(token: string): Promise<ClerkAuth> {
  let payload: JWTPayload;
  try {
    const verified = await jwtVerify(token, getJwks(), {
      algorithms: ["RS256"],
      clockTolerance: "5s",
    });
    payload = verified.payload;
  } catch (err) {
    throw errors.unauthenticated(
      `Clerk JWT verification failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const clerkUserId = claimAsString(payload, "clerk_user_id", "sub");
  if (!clerkUserId) {
    throw errors.unauthenticated("Missing clerk_user_id/sub claim");
  }
  // Canonical tenant identity. Read from the principal claim, never the body.
  const organizationId = claimAsString(payload, "organization_id");
  if (!organizationId) {
    throw errors.unauthenticated("Missing organization_id claim");
  }
  const role = claimAsString(payload, "role") ?? "member";

  return { clerk_user_id: clerkUserId, organization_id: organizationId, role };
}

/**
 * Resolve a local users row from the verified Clerk principal.
 *
 * Fail-open by design: a DB error MUST NOT 500 a request that already
 * carries a valid Clerk JWT. The seam is purely additive metadata for
 * future RBAC; rotas hoje seguem operando com `req.auth` apenas. Logged
 * via the request logger so a real outage is observable but non-fatal.
 *
 * Returns null when:
 *   - no row exists for the `clerk_user_id` (webhook lag / not provisioned);
 *   - the DB query throws (treated as "not resolvable right now").
 */
async function resolveLocalUser(
  log: FastifyBaseLogger,
  clerkUserId: string,
): Promise<LocalUserRow | null> {
  try {
    return await findUserByClerkUserId(clerkUserId);
  } catch (err) {
    log.warn(
      { err: err instanceof Error ? err.message : String(err) },
      "clerk-auth: local user resolution failed; proceeding without req.user",
    );
    return null;
  }
}

const plugin: FastifyPluginAsync = async (app: FastifyInstance) => {
  app.decorateRequest("auth", undefined);
  app.decorateRequest("user", undefined);

  app.decorate("requireClerkAuth", (): preHandlerHookHandler => {
    return async (req) => {
      // Test seam — honored ONLY when the explicit feature flag
      // TEST_AUTH_BYPASS_ENABLED=true is set (mirrors the
      // organization-scope test seam). Lets integration tests exercise
      // Clerk-guarded routes without a live JWKS endpoint. Read
      // process.env directly so it never depends on full config
      // validation. Defense-in-depth: the env schema additionally
      // REJECTS TEST_AUTH_BYPASS_ENABLED=true when NODE_ENV=production,
      // so a production deploy never reaches this branch even if the
      // env var is accidentally set.
      if (isTestAuthBypassEnabled()) {
        const h = req.headers["x-test-clerk-organization"];
        const v = Array.isArray(h) ? h[0] : h;
        if (typeof v === "string" && v.length > 0) {
          req.auth = {
            clerk_user_id: "test_clerk_user",
            organization_id: v,
            role: "member",
          };
          // Additive local-user resolution under the test seam too so
          // integration tests can stage a `users` row and assert
          // `req.user` without spinning up JWKS.
          req.user = await resolveLocalUser(req.log, req.auth.clerk_user_id);
          return;
        }
      }

      const header = req.headers.authorization;
      if (typeof header !== "string" || !header.startsWith("Bearer ")) {
        throw errors.unauthenticated("Missing Bearer token");
      }
      const token = header.slice("Bearer ".length).trim();
      if (token.length === 0) {
        throw errors.unauthenticated("Empty Bearer token");
      }
      req.auth = await verifyClerkJwt(token);
      // Additive: resolve local user row (null if not provisioned).
      req.user = await resolveLocalUser(req.log, req.auth.clerk_user_id);
    };
  });
};

export default fp(plugin, {
  name: "clerk-auth",
  fastify: "5.x",
});

export { type ClerkAuth };
