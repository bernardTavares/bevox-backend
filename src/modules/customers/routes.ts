/**
 * HTTP routes — customers module (PRD §10.1).
 *
 *  - GET/POST          /api/v1/organizations/:organization_id/customers
 *  - GET/PATCH          /api/v1/organizations/:organization_id/customers/:id
 *  - GET                /api/v1/customers/:id/profile
 *  - GET/POST           /api/v1/customers/:id/facts   (POST consumed by harness)
 *  - GET                /api/v1/customers/:id/export  (PRD §12.9 — LGPD DSR)
 *
 * ALL routes requireClerkAuth + requireOrganizationScope; mutations also
 * requireIdempotency. The `/api/v1/customers/:id/*` paths have no
 * `:organization_id` segment — organization_id comes from the
 * authenticated principal (req.organizationId), never the body.
 */

import type { FastifyInstance, FastifyPluginAsync } from "fastify";

import { errors } from "@/shared/errors.js";

import {
  customerCreateSchema,
  customerIdParamSchema,
  customerPatchSchema,
  factCreateSchema,
  orgIdParamSchema,
  orgParamSchema,
} from "./schemas.js";
import { addFact, create, exportData, facts, getOne, list, patch, profile } from "./service.js";

const plugin: FastifyPluginAsync = async (app: FastifyInstance) => {
  const read = { preHandler: [app.requireClerkAuth(), app.requireOrganizationScope()] };
  const write = {
    preHandler: [app.requireClerkAuth(), app.requireOrganizationScope(), app.requireIdempotency()],
  };

  function orgOf(req: { organizationId?: string }): string {
    const orgId = req.organizationId;
    if (!orgId) throw errors.unauthenticated("No authenticated organization principal");
    return orgId;
  }

  // NOTE: POST /customers/:id/merge (PRD §10.1) is deferred — out of
  // Marco-1 scope (§16.1 customers CRUD only); Marco 2+.
  app.get("/api/v1/organizations/:organization_id/customers", read, async (req, reply) => {
    const { organization_id } = orgParamSchema.parse(req.params);
    return reply.status(200).send(await list(organization_id));
  });

  app.post("/api/v1/organizations/:organization_id/customers", write, async (req, reply) => {
    const { organization_id } = orgParamSchema.parse(req.params);
    const body = customerCreateSchema.parse(req.body);
    return reply.status(201).send(await create(organization_id, body));
  });

  app.get("/api/v1/organizations/:organization_id/customers/:id", read, async (req, reply) => {
    const { organization_id, id } = orgIdParamSchema.parse(req.params);
    return reply.status(200).send(await getOne(organization_id, id));
  });

  app.patch("/api/v1/organizations/:organization_id/customers/:id", write, async (req, reply) => {
    const { organization_id, id } = orgIdParamSchema.parse(req.params);
    const body = customerPatchSchema.parse(req.body);
    return reply.status(200).send(await patch(organization_id, id, body));
  });

  app.get("/api/v1/customers/:id/profile", read, async (req, reply) => {
    const { id } = customerIdParamSchema.parse(req.params);
    return reply.status(200).send(await profile(orgOf(req), id));
  });

  app.get("/api/v1/customers/:id/facts", read, async (req, reply) => {
    const { id } = customerIdParamSchema.parse(req.params);
    return reply.status(200).send(await facts(orgOf(req), id));
  });

  app.post("/api/v1/customers/:id/facts", write, async (req, reply) => {
    const { id } = customerIdParamSchema.parse(req.params);
    const body = factCreateSchema.parse(req.body);
    return reply.status(201).send(await addFact(orgOf(req), id, body));
  });

  /**
   * GET /api/v1/customers/:id/export — DSR export (PRD §12.9, LGPD).
   *
   * POC (`no-dsr-export-endpoint`): retorna estrutura canônica do export
   * com `customer` + `facts` reais e `messages`/`audit_events` como arrays
   * vazios (placeholder até Marco-3 hidratar). Auth idêntica às demais
   * rotas sem `:organization_id` na URL: requireClerkAuth +
   * requireOrganizationScope deriva `organization_id` do principal.
   *
   * Follow-ups (Marco-3):
   *   - query real de messages/conversations
   *   - query real de audit_events filtrado por customer_id
   *   - assinatura HMAC do payload + Content-Disposition: attachment
   *   - opcional CSV export
   */
  app.get("/api/v1/customers/:id/export", read, async (req, reply) => {
    const { id } = customerIdParamSchema.parse(req.params);
    return reply.status(200).send(await exportData(orgOf(req), id));
  });
};

export const customersRoutes = plugin;
