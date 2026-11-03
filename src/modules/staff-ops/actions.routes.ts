/**
 * 6 POST de ação manual (B4) — cross-org, requireStaff
 * support|admin (observer NÃO). reason obrigatório (actionBodySchema).
 */
import type { FastifyInstance, FastifyPluginAsync, FastifyRequest } from "fastify";

import { actionBodySchema, idParam } from "./schemas.js";
import * as svc from "./actions.service.js";

const plugin: FastifyPluginAsync = async (app: FastifyInstance) => {
  const guard = { preHandler: [app.requireStaff({ roles: ["bevox_admin", "bevox_support"] })] };
  const B = "/api/v1/staff";
  // `req.staff` é decorado pelo staff-auth plugin (typed augmentation em
  // src/types/global.d.ts). requireStaff garante presença antes do handler.
  const actor = (req: FastifyRequest) => req.staff?.staff_id ?? "unknown";

  app.post(`${B}/executions/:id/replay`, guard, async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const { reason } = actionBodySchema.parse(req.body);
    return reply.send(await svc.replay(id, reason, actor(req)));
  });
  app.post(`${B}/executions/:id/cancel`, guard, async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const { reason } = actionBodySchema.parse(req.body);
    return reply.send(await svc.cancel(id, reason, actor(req)));
  });
  app.post(`${B}/executions/:id/override-ai`, guard, async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const { reason } = actionBodySchema.parse(req.body);
    return reply.send(await svc.overrideAi(id, reason, actor(req)));
  });
  app.post(`${B}/executions/:id/override-human`, guard, async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const { reason } = actionBodySchema.parse(req.body);
    return reply.send(await svc.overrideHuman(id, reason, actor(req)));
  });
  app.post(`${B}/executions/:id/unlock`, guard, async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const { reason } = actionBodySchema.parse(req.body);
    return reply.send(await svc.unlock(id, reason, actor(req)));
  });
  app.post(`${B}/dead-letters/:id/replay`, guard, async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const { reason } = actionBodySchema.parse(req.body);
    return reply.send(await svc.deadLetterReplay(id, reason, actor(req)));
  });
};

export const staffOpsActionsRoutes = plugin;
