/**
 * The 4 harness → backend callback routes (PRD §10.4). All authenticated
 * via the execution-token plugin (`X-Execution-Token`):
 *
 *   - PATCH /api/v1/executions/:id/status
 *   - POST  /api/v1/executions/:id/traces
 *   - POST  /api/v1/executions/:id/stream
 *   - POST  /api/v1/executions/:id/complete   (Marco-1 STUB)
 *
 * The harness is `organization_id`-native (ADR-019): callback bodies carry
 * `organization_id` directly — no translation. `/complete` is a Marco-1 stub:
 * it validates + persists execution state with the ADR-011 concurrency
 * guard, but the inference/proposal/SSE work is deferred to Marco 2.
 */

import type { FastifyInstance, FastifyPluginAsync } from "fastify";
import { z } from "zod";

import { resolveComplete } from "@/modules/executions/complete-service.js";
import { getRedis } from "@/lib/redis.js";
import { publishRealtime } from "@/modules/realtime/publish.js";
import {
  assertTokenBoundToRoute,
  resolveExecutionToken,
  resolveExecutionTokenAnyStatus,
} from "@/plugins/execution-token.js";
import { errors } from "@/shared/errors.js";

import {
  CompleteCallbackSchema,
  StatusCallbackSchema,
  StreamCallbackSchema,
  TracesCallbackSchema,
} from "./harness-callbacks.schema.js";
import {
  applyStatusTransition,
  findExecution,
  finalizeCompletion,
  insertExecutionAudit,
  insertExecutionTraces,
  lockForCompletion,
  markExecutionDeadLetter,
} from "./harness-callbacks.repository.js";

const idParamSchema = z.object({
  id: z.string().uuid(),
});

const plugin: FastifyPluginAsync = async (app: FastifyInstance) => {
  // PATCH /api/v1/executions/:id/status
  //
  // Dead-letter-aware auth (dispatch-contract amendment 2026-06-03, Option 2):
  // the 3 other callbacks keep the default terminal-excluding token resolution;
  // only `status='dead_letter'` resolves regardless of status, because the
  // authoritative dead_letter transition (ADR-019 Amendment 1) must act on
  // terminal executions (e.g. `error`).
  app.patch(
    "/api/v1/executions/:id/status",
    {
      preHandler: async (req) => {
        const headerVal = req.headers["x-execution-token"];
        const token = Array.isArray(headerVal) ? headerVal[0] : headerVal;
        if (typeof token !== "string" || token.length === 0) {
          throw errors.unauthenticated("Missing X-Execution-Token header");
        }
        const status = (req.body as { status?: unknown } | undefined)?.status;
        const ctx =
          status === "dead_letter"
            ? await resolveExecutionTokenAnyStatus(token)
            : await resolveExecutionToken(token);
        assertTokenBoundToRoute(req.params, ctx);
        req.executionContext = ctx;
      },
    },
    async (req, reply) => {
      const { id } = idParamSchema.parse(req.params);
      const body = StatusCallbackSchema.parse(req.body);
      if (body.status === "dead_letter") {
        const outcome = await markExecutionDeadLetter(id);
        if (outcome === "not_found") throw errors.notFound("Execution", id);
        return reply.status(200).send({ ok: true, outcome });
      }
      const ok = await applyStatusTransition(id, body.status);
      if (!ok) throw errors.notFound("Execution", id);
      return reply.status(200).send({ ok: true });
    },
  );

  // POST /api/v1/executions/:id/traces
  app.post(
    "/api/v1/executions/:id/traces",
    { preHandler: [app.requireExecutionToken()] },
    async (req, reply) => {
      const { id } = idParamSchema.parse(req.params);
      const body = TracesCallbackSchema.parse(req.body);
      const exec = await findExecution(id);
      if (!exec) throw errors.notFound("Execution", id);
      const n = await insertExecutionTraces(
        id,
        exec.organization_id,
        body.traces as Array<Record<string, unknown>>,
      );
      await publishRealtime(exec.organization_id, "execution.traces", {
        execution_id: id,
        count: n,
      });
      return reply.status(200).send({ accepted: n });
    },
  );

  // POST /api/v1/executions/:id/stream
  app.post(
    "/api/v1/executions/:id/stream",
    { preHandler: [app.requireExecutionToken()] },
    async (req, reply) => {
      const { id } = idParamSchema.parse(req.params);
      const body = StreamCallbackSchema.parse(req.body);
      const exec = await findExecution(id);
      if (!exec) throw errors.notFound("Execution", id);
      const r = getRedis();
      const key = `stream:${id}`;
      // O EXPIRE é um TTL DESLIZANTE de 1h (resetado a cada chunk) de
      // propósito: execuções longas (>1h) não perdem o buffer no meio do
      // stream. A sequência rpush→expire→publishRealtime é fail-loud e
      // não-isolada: se `expire` falha após `rpush` a key fica sem TTL até
      // ser drenada, e um 500 após `rpush` pode duplicar chunks em retry do
      // harness (aceitável: o buffer de stream é observability efêmera; o
      // `index` é carregado para ordenação/dedupe client-side).
      await r.rpush(key, JSON.stringify({ index: body.index, chunk: body.chunk }));
      await r.expire(key, 3600);
      await publishRealtime(exec.organization_id, "execution.stream", {
        execution_id: id,
        index: body.index,
        chunk: body.chunk,
      });
      return reply.status(200).send({ accepted: true, index: body.index });
    },
  );

  // POST /api/v1/executions/:id/complete — Marco-1 STUB.
  app.post(
    "/api/v1/executions/:id/complete",
    { preHandler: [app.requireExecutionToken()] },
    async (req, reply) => {
      const { id } = idParamSchema.parse(req.params);
      const body = CompleteCallbackSchema.parse(req.body);

      const existing = await findExecution(id);
      if (!existing) throw errors.notFound("Execution", id);

      // Harness is organization_id-native (ADR-019): read organization_id
      // directly from the callback body; fall back to the row when absent.
      const bodyOrgId = (req.body as Record<string, unknown>)["organization_id"];
      const organizationId =
        typeof bodyOrgId === "string" && bodyOrgId.length > 0
          ? bodyOrgId
          : existing.organization_id;

      // ADR-011 concurrency guard: atomic dispatching/processing/
      // waiting_input → completing. No row → already terminal/raced → 409.
      const locked = await lockForCompletion(id);
      if (!locked) {
        throw errors.conflict("Execution is not in a completable state", {
          execution_id: id,
        });
      }

      // ADR-007 §6 desfecho (ADR-019 — sobre a execução, sem AISuggestion).
      // O bloco Marco-1 acima (lock/finalize/audit) é PRESERVADO; este passo
      // decide entrega vs retenção ANTES do finalize.
      const outcome = await resolveComplete({
        organizationId,
        executionId: id,
        executionMode: locked.execution_mode,
        strategy: body.strategy,
        responseText: body.response_text,
        proposals: body.proposals ?? [],
      });

      const resultPayload = {
        response_text: body.response_text,
        sentiment: body.sentiment,
        strategy: body.strategy,
        usage: body.usage,
        proposals: body.proposals ?? [],
        ...outcome.resultPayloadExtra,
      };
      await finalizeCompletion(id, outcome.finalStatus, resultPayload);

      await insertExecutionAudit({
        organizationId,
        executionId: id,
        action: `execution.complete.${outcome.finalStatus}`,
        afterJson: {
          execution_mode: locked.execution_mode,
          final_status: outcome.finalStatus,
          suggestion_type: outcome.suggestionType,
          strategy: body.strategy,
        },
      });

      return reply.status(200).send({ ok: true, status: outcome.finalStatus });
    },
  );
};

export const harnessCallbackRoutes = plugin;
