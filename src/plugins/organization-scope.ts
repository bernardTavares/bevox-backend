/**
 * Plugin Fastify — tenancy guard de organização (PRD §7.2 `organization-scope`).
 *
 * Tenant identity = organizationId (canon _shared/ADR-021, accepted,
 * supersedes hub-ADR-003). The harness is organization_id-native
 * (ADR-019); the resolveOrganizationId bridge was collapsed (SP-3 Phase
 * 2). The legacy tenant token is retired — it appears nowhere.
 *
 * `organization_id`/`organizations` é a identidade canônica de tenant.
 * O guard:
 *   1. Extrai o `organization_id` do principal autenticado:
 *      - Clerk: `request.auth.organization_id`.
 *      - Staff impersonando: `request.staff.impersonation_id`.
 *      - (test seam) header `x-test-claim-organization`, honrado APENAS
 *        quando a feature flag `TEST_AUTH_BYPASS_ENABLED=true` está
 *        explicitamente setada (defense-in-depth: o env schema REJEITA
 *        a flag quando `NODE_ENV=production`, então um deploy de prod
 *        nunca alcança esse ramo, mesmo se a var for setada por engano).
 *   2. Compara com o route param `:organization_id`; 403 em mismatch.
 *   3. Decora `request.organizationId`.
 *
 * NUNCA lê organization_id do body. Expõe `app.requireOrganizationScope()`.
 */

import fp from "fastify-plugin";
import type {
  FastifyInstance,
  FastifyPluginAsync,
  FastifyReply,
  FastifyRequest,
  preHandlerHookHandler,
} from "fastify";

import { AppError } from "@/shared/errors.js";

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

function claimOrganizationId(req: FastifyRequest): string | undefined {
  // 1. Clerk-authenticated product user.
  if (req.auth?.organization_id) return req.auth.organization_id;

  // 2. Staff impersonation context (a staff principal acting inside a
  //    specific organization carries the org as impersonation_id).
  if (req.staff?.impersonation_id) return req.staff.impersonation_id;

  // 3. Test seam — honored ONLY when TEST_AUTH_BYPASS_ENABLED=true
  //    (explicit feature flag; defense-in-depth, prod env schema
  //    rejects). Read process.env directly (NOT env()) so the seam
  //    never depends on full config validation in isolated unit tests.
  if (isTestAuthBypassEnabled()) {
    const h = req.headers["x-test-claim-organization"];
    const v = Array.isArray(h) ? h[0] : h;
    if (typeof v === "string" && v.length > 0) return v;
  }

  return undefined;
}

function paramOrganizationId(req: FastifyRequest): string | undefined {
  const params = req.params as Record<string, unknown> | undefined;
  const v = params?.["organization_id"];
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

/**
 * Envia o JSON canônico de erro diretamente. O guard NÃO depende de um
 * error handler global estar registrado (rotas isoladas / unit tests
 * registram só este plugin), mantendo o mesmo shape do error-handler.
 */
function denyWith(reply: FastifyReply, err: AppError, requestId: string): FastifyReply {
  return reply.status(err.httpStatus).send({
    error: {
      code: err.code,
      message: err.message,
      details: err.details,
      request_id: requestId,
    },
  });
}

const plugin: FastifyPluginAsync = async (app: FastifyInstance) => {
  app.decorateRequest("organizationId", undefined);

  app.decorate("requireOrganizationScope", (): preHandlerHookHandler => {
    return async (req, reply) => {
      const claim = claimOrganizationId(req);
      if (!claim) {
        return denyWith(
          reply,
          new AppError({
            code: "UNAUTHENTICATED",
            message: "No authenticated organization principal",
          }),
          req.id,
        );
      }

      const param = paramOrganizationId(req);
      if (param && param !== claim) {
        return denyWith(
          reply,
          new AppError({
            code: "FORBIDDEN",
            message: "Organization scope mismatch",
            // No PII; both are organization_id UUIDs.
            details: { path_organization_id: param, principal_organization_id: claim },
          }),
          req.id,
        );
      }

      req.organizationId = claim;
      return undefined;
    };
  });
};

export default fp(plugin, {
  name: "organization-scope",
  fastify: "5.x",
});

export { claimOrganizationId };
