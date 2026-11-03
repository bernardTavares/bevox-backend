/**
 * Ciclo de aprovação sobre a execução (bevox-backend/ADR-019 — supersedes hub ADR-025; PRD §5.6 Módulo 9).
 *   GET  /api/v1/organizations/:organization_id/executions?status=&suggestion_type=
 *   POST .../executions/:id/approve | /edit | /reject
 * Clerk + org-scope; mutações com requireIdempotency.
 */
import type { FastifyInstance, FastifyPluginAsync } from "fastify";

import {
  idParamSchema,
  orgParamSchema,
  listQuerySchema,
  editBodySchema,
  rejectBodySchema,
} from "./schemas.js";
import { approve, edit, list, reject } from "./service.js";

const plugin: FastifyPluginAsync = async (app: FastifyInstance) => {
  const read = { preHandler: [app.requireClerkAuth(), app.requireOrganizationScope()] };
  const write = {
    preHandler: [app.requireClerkAuth(), app.requireOrganizationScope(), app.requireIdempotency()],
  };

  app.get("/api/v1/organizations/:organization_id/executions", read, async (req, reply) => {
    const { organization_id } = orgParamSchema.parse(req.params);
    const q = listQuerySchema.parse(req.query);
    return reply.status(200).send(await list(organization_id, q.status, q.suggestion_type));
  });

  app.post(
    "/api/v1/organizations/:organization_id/executions/:id/approve",
    write,
    async (req, reply) => {
      const { organization_id, id } = idParamSchema.parse(req.params);
      return reply
        .status(200)
        .send(await approve(organization_id, id, req.auth?.clerk_user_id ?? null));
    },
  );

  app.post(
    "/api/v1/organizations/:organization_id/executions/:id/edit",
    write,
    async (req, reply) => {
      const { organization_id, id } = idParamSchema.parse(req.params);
      const body = editBodySchema.parse(req.body);
      return reply
        .status(200)
        .send(await edit(organization_id, id, body, req.auth?.clerk_user_id ?? null));
    },
  );

  app.post(
    "/api/v1/organizations/:organization_id/executions/:id/reject",
    write,
    async (req, reply) => {
      const { organization_id, id } = idParamSchema.parse(req.params);
      const body = rejectBodySchema.parse(req.body);
      return reply
        .status(200)
        .send(await reject(organization_id, id, body, req.auth?.clerk_user_id ?? null));
    },
  );
};

export const executionsRoutes = plugin;
