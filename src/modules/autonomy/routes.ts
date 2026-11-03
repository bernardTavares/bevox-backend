/**
 * HTTP routes — autonomy module (PRD §5.5 / Modelo §10.5).
 *   GET   /api/v1/organizations/:organization_id/autonomy
 *   PATCH /api/v1/organizations/:organization_id/autonomy
 * Canon endpoint `/workspaces/:id/autonomy` reconciliado p/ forma
 * org-native (ADR-021; precedente A/B1/C, ai-suggestions colapsado em
 * executions per ADR-019).
 */

import type { FastifyInstance, FastifyPluginAsync } from "fastify";

import { orgParamSchema, patchBodySchema } from "./schemas.js";
import { getAutonomy, patchAutonomy } from "./service.js";

const plugin: FastifyPluginAsync = async (app: FastifyInstance) => {
  const guard = { preHandler: [app.requireClerkAuth(), app.requireOrganizationScope()] };

  app.get("/api/v1/organizations/:organization_id/autonomy", guard, async (req, reply) => {
    const { organization_id } = orgParamSchema.parse(req.params);
    return reply.status(200).send(await getAutonomy(organization_id));
  });

  app.patch("/api/v1/organizations/:organization_id/autonomy", guard, async (req, reply) => {
    const { organization_id } = orgParamSchema.parse(req.params);
    const body = patchBodySchema.parse(req.body);
    const actor = req.auth?.clerk_user_id ?? null;
    return reply.status(200).send(await patchAutonomy(organization_id, body, actor));
  });
};

export const autonomyRoutes = plugin;
