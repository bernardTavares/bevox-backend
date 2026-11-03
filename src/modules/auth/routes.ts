/**
 * Rotas HTTP do módulo auth (staff Bevox) — ADR-013.
 *
 *  - POST /api/v1/staff/sessions                       (login)
 *  - POST /api/v1/staff/sessions/refresh               (rotação)
 *  - POST /api/v1/staff/impersonation/:organization_id/start
 *  - POST /api/v1/staff/impersonation/:organization_id/end
 *  - POST /api/v1/webhooks/clerk                       (svix-verified)
 *
 * Validação Zod em TODA entrada. Cripto 100% reusada de
 * `@/plugins/staff-auth.js` (helpers exportados). Tenant = organization_id
 * (ADR-021) — nunca o lexicon de tenant legado. Roles canônicas
 * `bevox_admin|bevox_support|bevox_observer`.
 *
 * Hook de auditoria de impersonation (onResponse, escopado a este plugin):
 * QUALQUER rota de staff servida com um token portando `impersonation_id`
 * emite um audit_event (actor_id=staff_id, after_json.impersonation_id) —
 * ADR-013 + PRD §12.8. Idempotente por request.
 */

import { Webhook } from "svix";
import type { FastifyInstance, FastifyPluginAsync, FastifyRequest } from "fastify";

import { env } from "@/config/env.js";
import { errors } from "@/shared/errors.js";

import {
  clerkWebhookEventSchema,
  impersonationStartBodySchema,
  organizationIdParamSchema,
  staffLoginBodySchema,
  staffRefreshBodySchema,
} from "./schemas.js";
import {
  auditImpersonatedAction,
  endImpersonationSession,
  loginStaff,
  refreshStaffSession,
  startImpersonation,
} from "./service.js";
import {
  deleteUserByClerkId,
  findOrganizationByClerkOrg,
  upsertUserFromClerk,
} from "./repository.js";

declare module "fastify" {
  interface FastifyRequest {
    clerkRawBody?: string;
    impersonationAudited?: boolean;
  }
}

const plugin: FastifyPluginAsync = async (app: FastifyInstance) => {
  // Captura raw body APENAS para a rota do webhook Clerk (svix exige o
  // payload byte-a-byte). Scoped por encapsulação Fastify deste plugin.
  app.addContentTypeParser("application/json", { parseAs: "string" }, (_req, body, done) => {
    const raw = typeof body === "string" ? body : body.toString("utf8");
    (_req as FastifyRequest).clerkRawBody = raw;
    try {
      done(null, raw.length === 0 ? {} : JSON.parse(raw));
    } catch (err) {
      done(err as Error);
    }
  });

  // ----- Hook de auditoria de impersonation -----
  // onResponse: roda após o handler. Se o token de staff carregava um
  // impersonation_id, registra a ação. Idempotente por request.
  app.addHook("onResponse", async (req) => {
    const staff = req.staff;
    if (!staff?.impersonation_id || req.impersonationAudited) return;
    // 'start'/'end' já emitem o seu próprio audit_event dedicado; o hook
    // cobre QUALQUER outra ação de staff sob impersonation.
    req.impersonationAudited = true;
    try {
      await auditImpersonatedAction({
        staffId: staff.staff_id,
        impersonationId: staff.impersonation_id,
        method: req.method,
        route: req.routeOptions?.url ?? req.url.split("?")[0] ?? req.url,
      });
    } catch {
      // Falha de auditoria não deve mascarar a resposta já enviada; o
      // erro é capturado pelo error-handler/telemetry em paths normais.
    }
  });

  // ----- POST /api/v1/staff/sessions -----
  app.post("/api/v1/staff/sessions", async (req, reply) => {
    const body = staffLoginBodySchema.parse(req.body);
    const tokens = await loginStaff({ email: body.email, password: body.password });
    return reply.status(200).send(tokens);
  });

  // ----- POST /api/v1/staff/sessions/refresh -----
  app.post("/api/v1/staff/sessions/refresh", async (req, reply) => {
    const body = staffRefreshBodySchema.parse(req.body);
    const tokens = await refreshStaffSession({ refreshToken: body.refresh_token });
    return reply.status(200).send(tokens);
  });

  // ----- POST /api/v1/staff/impersonation/:organization_id/start -----
  app.post(
    "/api/v1/staff/impersonation/:organization_id/start",
    { preHandler: [app.requireStaff({ roles: ["bevox_admin", "bevox_support"] })] },
    async (req, reply) => {
      const { organization_id } = organizationIdParamSchema.parse(req.params);
      const body = impersonationStartBodySchema.parse(req.body);
      const staff = req.staff!;
      const result = await startImpersonation({
        staffId: staff.staff_id,
        staffRole: staff.role,
        organizationId: organization_id,
        reason: body.reason,
        category: body.category,
      });
      return reply.status(200).send(result);
    },
  );

  // ----- POST /api/v1/staff/impersonation/:organization_id/end -----
  app.post(
    "/api/v1/staff/impersonation/:organization_id/end",
    { preHandler: [app.requireStaff()] },
    async (req, reply) => {
      const { organization_id } = organizationIdParamSchema.parse(req.params);
      const staff = req.staff!;
      if (!staff.impersonation_id) {
        throw errors.invalidInput("No active impersonation in token");
      }
      const result = await endImpersonationSession({
        staffId: staff.staff_id,
        organizationId: organization_id,
        impersonationId: staff.impersonation_id,
      });
      return reply.status(200).send(result);
    },
  );

  // ----- POST /api/v1/webhooks/clerk (svix) -----
  app.post("/api/v1/webhooks/clerk", async (req, reply) => {
    const cfg = env();
    if (!cfg.CLERK_WEBHOOK_SECRET) {
      throw errors.internal("CLERK_WEBHOOK_SECRET is not configured");
    }
    const raw = req.clerkRawBody ?? "";
    const headers = {
      "svix-id": String(req.headers["svix-id"] ?? ""),
      "svix-timestamp": String(req.headers["svix-timestamp"] ?? ""),
      "svix-signature": String(req.headers["svix-signature"] ?? ""),
    };
    let verified: unknown;
    try {
      const wh = new Webhook(cfg.CLERK_WEBHOOK_SECRET);
      verified = wh.verify(raw, headers);
    } catch {
      throw errors.invalidInput("Invalid Clerk webhook signature");
    }

    const event = clerkWebhookEventSchema.parse(verified);
    const data = event.data as Record<string, unknown>;
    const clerkUserId = typeof data.id === "string" ? data.id : null;

    if (event.type === "user.created" || event.type === "user.updated") {
      if (clerkUserId) {
        // Clerk org/claim → organization_id (ADR-013). Marco-1: resolve
        // pelo mapping já-sincronizado; se não houver, é no-op idempotente.
        const orgClaim =
          typeof data.organization_id === "string" ? data.organization_id : clerkUserId;
        const organizationId = await findOrganizationByClerkOrg(orgClaim);
        if (organizationId) {
          const first = typeof data.first_name === "string" ? data.first_name : "";
          const last = typeof data.last_name === "string" ? data.last_name : "";
          const emails = Array.isArray(data.email_addresses)
            ? (data.email_addresses as Array<{ email_address?: string }>)
            : [];
          await upsertUserFromClerk({
            clerkUserId,
            organizationId,
            name: `${first} ${last}`.trim() || clerkUserId,
            email: emails[0]?.email_address ?? null,
          });
        }
      }
    } else if (event.type === "user.deleted") {
      if (clerkUserId) {
        await deleteUserByClerkId(clerkUserId);
      }
    }

    return reply.status(200).send({ ok: true });
  });
};

export const authRoutes = plugin;
