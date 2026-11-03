/**
 * C2 Google — endpoints org-scoped do CLIENTE (Clerk + organization-scope):
 *   GET  .../calendars/:id/google/connect      → authorize_url
 *   GET  .../calendars/:id/google/connections   → lista de conexões
 *   POST .../google/connections/:cid/disconnect → revoga (tenant-checked)
 *
 * Lexicon ADR-021: organization/organizationId (zero workspace/account/tenant).
 */
import type { FastifyInstance, FastifyPluginAsync } from "fastify";
import { z } from "zod";

import { errors } from "@/shared/errors.js";

import { buildAuthorizeUrl, revokeConnection } from "./oauth.js";
import * as repo from "./repository.js";

const uuid = z.string().uuid();
const calIdParam = z.object({ organization_id: uuid, id: uuid });
const connectQuery = z.object({ professional_id: uuid.optional() });
const disconnectParam = z.object({
  organization_id: uuid,
  connection_id: uuid,
});

const plugin: FastifyPluginAsync = async (app: FastifyInstance) => {
  const scoped = {
    preHandler: [app.requireClerkAuth(), app.requireOrganizationScope()],
  };
  const B = "/api/v1/organizations/:organization_id";

  app.get(`${B}/calendars/:id/google/connect`, scoped, async (req, reply) => {
    const { organization_id, id } = calIdParam.parse(req.params);
    const q = connectQuery.parse(req.query ?? {});
    // user_id real do principal autenticado (clerk-auth: req.auth.clerk_user_id).
    // requireClerkAuth garante req.auth populado (verifyClerkJwt lança caso
    // contrário) → clerk_user_id é sempre o id real em runtime, sem fallback.
    const authorizeUrl = await buildAuthorizeUrl({
      organizationId: organization_id,
      calendarId: id,
      professionalId: q.professional_id ?? null,
      userId: req.auth!.clerk_user_id,
    });
    return reply.status(200).send({ authorize_url: authorizeUrl });
  });

  app.get(`${B}/calendars/:id/google/connections`, scoped, async (req, reply) => {
    const { organization_id, id } = calIdParam.parse(req.params);
    return reply.status(200).send({ data: await repo.listConnections(organization_id, id) });
  });

  app.post(`${B}/google/connections/:connection_id/disconnect`, scoped, async (req, reply) => {
    const { organization_id, connection_id } = disconnectParam.parse(req.params);
    // Tenant check: a conexão DEVE pertencer à organization do principal.
    // Sem isto, revoke cross-org seria possível (IDOR).
    const conn = await repo.findConnectionById(connection_id);
    if (!conn || conn.organization_id !== organization_id) {
      throw errors.notFound("CalendarProviderConnection", connection_id);
    }
    await revokeConnection(connection_id);
    return reply.status(200).send({ ok: true });
  });
};

export const googleRoutes = plugin;
