/**
 * HTTP routes — channels module (PRD §10.1, minimal real read surface).
 *   GET /api/v1/organizations/:organization_id/channel-connections
 */

import type { FastifyInstance, FastifyPluginAsync } from "fastify";

import { orgParam } from "./schemas.js";
import { listConnections } from "./service.js";

const plugin: FastifyPluginAsync = async (app: FastifyInstance) => {
  const read = { preHandler: [app.requireClerkAuth(), app.requireOrganizationScope()] };
  app.get(
    "/api/v1/organizations/:organization_id/channel-connections",
    read,
    async (req, reply) => {
      const { organization_id } = orgParam.parse(req.params);
      return reply.status(200).send(await listConnections(organization_id));
    },
  );
};

export const channelsRoutes = plugin;
