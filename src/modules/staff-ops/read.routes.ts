/**
 * Reads ops Módulo 17 (B4) — cross-org, requireStaff (qualquer role:
 * observer+support+admin).
 */
import type { FastifyInstance, FastifyPluginAsync } from "fastify";

import { errors } from "@/shared/errors.js";
import { STAFF_ROLES } from "@/plugins/staff-auth.js";
import {
  auditQuerySchema,
  idParam,
  listQuerySchema,
  paginated,
  paginationSchema,
} from "./schemas.js";
import * as repo from "./read.repository.js";

const plugin: FastifyPluginAsync = async (app: FastifyInstance) => {
  const guard = { preHandler: [app.requireStaff({ roles: [...STAFF_ROLES] })] };
  const B = "/api/v1/staff";

  app.get(`${B}/dashboard/overview`, guard, async (req, reply) => {
    const q = listQuerySchema.parse(req.query);
    return reply.send(await repo.dashboardOverview(q.organization_id));
  });

  app.get(`${B}/executions`, guard, async (req, reply) => {
    const q = listQuerySchema.parse(req.query);
    const { page, perPage } = paginationSchema.parse(req.query);
    const { data, total } = await repo.listExecutions(q.organization_id, q, page, perPage);
    return reply.send(paginated(data, page, perPage, total));
  });

  app.get(`${B}/executions/:id`, guard, async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const q = listQuerySchema.parse(req.query);
    const row = await repo.getExecution(q.organization_id, id);
    if (!row) throw errors.notFound("Execution", id);
    return reply.send({ execution: row });
  });

  app.get(`${B}/executions/:id/traces`, guard, async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const q = listQuerySchema.parse(req.query);
    return reply.send(await repo.getTraces(q.organization_id, id));
  });

  app.get(`${B}/executions/:id/reasoning`, guard, async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const q = listQuerySchema.parse(req.query);
    const r = await repo.getReasoning(q.organization_id, id);
    if (!r) throw errors.notFound("Execution", id);
    return reply.send(r);
  });

  app.get(`${B}/executions/:id/intents`, guard, async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const q = listQuerySchema.parse(req.query);
    const r = await repo.getIntents(q.organization_id, id);
    if (!r) throw errors.notFound("Execution", id);
    return reply.send(r);
  });

  app.get(`${B}/conversations/:id/executions`, guard, async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const q = listQuerySchema.parse(req.query);
    return reply.send(await repo.listConversationExecutions(q.organization_id, id));
  });

  app.get(`${B}/windows`, guard, async (req, reply) => {
    const q = listQuerySchema.parse(req.query);
    const { page, perPage } = paginationSchema.parse(req.query);
    const { data, total } = await repo.listWindows(q.organization_id, q, page, perPage);
    return reply.send(paginated(data, page, perPage, total));
  });

  app.get(`${B}/windows/:id`, guard, async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const q = listQuerySchema.parse(req.query);
    const w = await repo.getWindow(q.organization_id, id);
    if (!w) throw errors.notFound("Window", id);
    return reply.send({ window: w });
  });

  app.get(`${B}/dead-letters`, guard, async (req, reply) => {
    const q = listQuerySchema.parse(req.query);
    const { page, perPage } = paginationSchema.parse(req.query);
    const { data, total } = await repo.listDeadLetters(q.organization_id, q, page, perPage);
    return reply.send(paginated(data, page, perPage, total));
  });

  app.get(`${B}/organization-health`, guard, async (req, reply) => {
    const q = listQuerySchema.parse(req.query);
    return reply.send(await repo.organizationHealth(q.organization_id));
  });

  app.get(`${B}/audit-events`, guard, async (req, reply) => {
    const q = auditQuerySchema.parse(req.query);
    const { page, perPage } = paginationSchema.parse(req.query);
    const { data, total } = await repo.listAuditEvents(q, page, perPage);
    return reply.send(paginated(data, page, perPage, total));
  });
};

export const staffOpsReadRoutes = plugin;
