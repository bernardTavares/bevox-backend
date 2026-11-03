/**
 * HTTP routes — services module (PRD §10.1).
 *
 *  - GET/POST            /api/v1/organizations/:organization_id/services
 *  - GET/PATCH/DELETE     /api/v1/organizations/:organization_id/services/:id
 *  - GET /api/v1/organizations/:organization_id/services/:id/professionals
 *
 * ALL routes requireClerkAuth + requireOrganizationScope; mutations also
 * requireIdempotency.
 */

import type { FastifyInstance, FastifyPluginAsync } from "fastify";

import {
  orgIdParamSchema,
  orgParamSchema,
  serviceCreateSchema,
  servicePatchSchema,
} from "./schemas.js";
import { create, getOne, list, listProfessionals, patch, remove } from "./service.js";

const plugin: FastifyPluginAsync = async (app: FastifyInstance) => {
  const read = { preHandler: [app.requireClerkAuth(), app.requireOrganizationScope()] };
  const write = {
    preHandler: [app.requireClerkAuth(), app.requireOrganizationScope(), app.requireIdempotency()],
  };

  app.get("/api/v1/organizations/:organization_id/services", read, async (req, reply) => {
    const { organization_id } = orgParamSchema.parse(req.params);
    return reply.status(200).send(await list(organization_id));
  });

  app.post("/api/v1/organizations/:organization_id/services", write, async (req, reply) => {
    const { organization_id } = orgParamSchema.parse(req.params);
    const body = serviceCreateSchema.parse(req.body);
    return reply.status(201).send(await create(organization_id, body));
  });

  app.get("/api/v1/organizations/:organization_id/services/:id", read, async (req, reply) => {
    const { organization_id, id } = orgIdParamSchema.parse(req.params);
    return reply.status(200).send(await getOne(organization_id, id));
  });

  app.patch("/api/v1/organizations/:organization_id/services/:id", write, async (req, reply) => {
    const { organization_id, id } = orgIdParamSchema.parse(req.params);
    const body = servicePatchSchema.parse(req.body);
    return reply.status(200).send(await patch(organization_id, id, body));
  });

  app.delete("/api/v1/organizations/:organization_id/services/:id", write, async (req, reply) => {
    const { organization_id, id } = orgIdParamSchema.parse(req.params);
    return reply.status(200).send(await remove(organization_id, id));
  });

  app.get(
    "/api/v1/organizations/:organization_id/services/:id/professionals",
    read,
    async (req, reply) => {
      const { organization_id, id } = orgIdParamSchema.parse(req.params);
      return reply.status(200).send(await listProfessionals(organization_id, id));
    },
  );
};

export const servicesRoutes = plugin;
