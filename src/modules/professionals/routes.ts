/**
 * HTTP routes — professionals module (PRD §10.1).
 *
 *  - GET/POST            /api/v1/organizations/:organization_id/professionals
 *  - GET/PATCH/DELETE     /api/v1/organizations/:organization_id/professionals/:id
 *
 * ALL routes requireClerkAuth + requireOrganizationScope; mutations also
 * requireIdempotency.
 */

import type { FastifyInstance, FastifyPluginAsync } from "fastify";

import {
  orgIdParamSchema,
  orgParamSchema,
  professionalCreateSchema,
  professionalPatchSchema,
} from "./schemas.js";
import { create, getOne, list, patch, remove } from "./service.js";

const plugin: FastifyPluginAsync = async (app: FastifyInstance) => {
  const read = { preHandler: [app.requireClerkAuth(), app.requireOrganizationScope()] };
  const write = {
    preHandler: [app.requireClerkAuth(), app.requireOrganizationScope(), app.requireIdempotency()],
  };

  app.get("/api/v1/organizations/:organization_id/professionals", read, async (req, reply) => {
    const { organization_id } = orgParamSchema.parse(req.params);
    return reply.status(200).send(await list(organization_id));
  });

  app.post("/api/v1/organizations/:organization_id/professionals", write, async (req, reply) => {
    const { organization_id } = orgParamSchema.parse(req.params);
    const body = professionalCreateSchema.parse(req.body);
    return reply.status(201).send(await create(organization_id, body));
  });

  app.get("/api/v1/organizations/:organization_id/professionals/:id", read, async (req, reply) => {
    const { organization_id, id } = orgIdParamSchema.parse(req.params);
    return reply.status(200).send(await getOne(organization_id, id));
  });

  app.patch(
    "/api/v1/organizations/:organization_id/professionals/:id",
    write,
    async (req, reply) => {
      const { organization_id, id } = orgIdParamSchema.parse(req.params);
      const body = professionalPatchSchema.parse(req.body);
      return reply.status(200).send(await patch(organization_id, id, body));
    },
  );

  app.delete(
    "/api/v1/organizations/:organization_id/professionals/:id",
    write,
    async (req, reply) => {
      const { organization_id, id } = orgIdParamSchema.parse(req.params);
      return reply.status(200).send(await remove(organization_id, id));
    },
  );
};

export const professionalsRoutes = plugin;
