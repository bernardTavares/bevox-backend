/**
 * HTTP routes — organizations module (PRD §10.1). The PRD prose module is
 * `workspaces`; built as `organizations` with `:organization_id` per
 * ADR-021. ALL routes: requireClerkAuth + requireOrganizationScope;
 * mutations also requireIdempotency.
 *
 *  - GET/PATCH  /api/v1/organizations/:organization_id
 *  - GET/PATCH  /api/v1/organizations/:organization_id/settings
 *  - GET        /api/v1/organizations/:organization_id/users
 *  - GET        /api/v1/organizations/:organization_id/onboarding
 *  - POST       /api/v1/organizations/:organization_id/onboarding/advance
 */

import type { FastifyInstance, FastifyPluginAsync } from "fastify";

import {
  onboardingAdvanceSchema,
  organizationIdParamSchema,
  organizationPatchSchema,
  settingsPatchSchema,
} from "./schemas.js";
import {
  advanceOnboardingStage,
  fetchOnboarding,
  fetchOrganization,
  fetchSettings,
  fetchUsers,
  patchOrganization,
  patchSettings,
} from "./service.js";

const plugin: FastifyPluginAsync = async (app: FastifyInstance) => {
  const read = { preHandler: [app.requireClerkAuth(), app.requireOrganizationScope()] };
  const write = {
    preHandler: [app.requireClerkAuth(), app.requireOrganizationScope(), app.requireIdempotency()],
  };

  app.get("/api/v1/organizations/:organization_id", read, async (req, reply) => {
    const { organization_id } = organizationIdParamSchema.parse(req.params);
    return reply.status(200).send(await fetchOrganization(organization_id));
  });

  app.patch("/api/v1/organizations/:organization_id", write, async (req, reply) => {
    const { organization_id } = organizationIdParamSchema.parse(req.params);
    const patch = organizationPatchSchema.parse(req.body);
    return reply.status(200).send(await patchOrganization(organization_id, patch));
  });

  app.get("/api/v1/organizations/:organization_id/settings", read, async (req, reply) => {
    const { organization_id } = organizationIdParamSchema.parse(req.params);
    return reply.status(200).send(await fetchSettings(organization_id));
  });

  app.patch("/api/v1/organizations/:organization_id/settings", write, async (req, reply) => {
    const { organization_id } = organizationIdParamSchema.parse(req.params);
    const patch = settingsPatchSchema.parse(req.body);
    return reply.status(200).send(await patchSettings(organization_id, patch));
  });

  app.get("/api/v1/organizations/:organization_id/users", read, async (req, reply) => {
    const { organization_id } = organizationIdParamSchema.parse(req.params);
    return reply.status(200).send(await fetchUsers(organization_id));
  });

  app.get("/api/v1/organizations/:organization_id/onboarding", read, async (req, reply) => {
    const { organization_id } = organizationIdParamSchema.parse(req.params);
    return reply.status(200).send(await fetchOnboarding(organization_id));
  });

  app.post(
    "/api/v1/organizations/:organization_id/onboarding/advance",
    write,
    async (req, reply) => {
      const { organization_id } = organizationIdParamSchema.parse(req.params);
      const { stage } = onboardingAdvanceSchema.parse(req.body);
      return reply.status(200).send(await advanceOnboardingStage(organization_id, stage));
    },
  );
};

export const organizationsRoutes = plugin;
