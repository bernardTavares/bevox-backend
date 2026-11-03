/**
 * Zod schemas for the 4 harness → backend callback bodies (PRD §10.4).
 *
 * All callbacks authenticate via `X-Execution-Token` (execution-token
 * plugin). The harness is `organization_id`-native (ADR-019): callback
 * bodies carry `organization_id` directly. `.passthrough()` keeps it
 * available; the route reads it without any translation.
 */

import { z } from "zod";

// `dead_letter` (dispatch-contract amendment, PRD §10.4 + ADR-019 Amendment 1,
// aceito 2026-06-03): the harness emits it on BullMQ attempts-exhaustion. The
// transition is authoritative (see `markExecutionDeadLetter`).
export const StatusCallbackSchema = z.object({
  status: z.enum(["running", "paused", "cancelled", "dead_letter"]),
});

export const TraceEntrySchema = z.object({}).passthrough();
export const TracesCallbackSchema = z.object({
  traces: z.array(TraceEntrySchema),
});

export const StreamCallbackSchema = z.object({
  chunk: z.string().max(4096),
  index: z.number().int().nonnegative(),
});

export const ProposalSchema = z.object({
  action: z.enum([
    "create-appointment",
    "cancel-appointment",
    "reschedule-appointment",
    "create-charge",
    "create-refund",
    "send-message",
    "waitlist-add",
  ]),
  params: z.record(z.string(), z.unknown()),
  idempotency_key: z.string().min(1),
});

/**
 * `/complete` body (PRD §10.4). The tenant field is `organization_id`
 * (ADR-019); `.passthrough()` keeps it available and the route reads it
 * directly — no translation.
 */
export const CompleteCallbackSchema = z
  .object({
    response_text: z.string(),
    sentiment: z.enum(["positive", "neutral", "negative", "frustrated", "angry", "confused"]),
    // PRD §10.4 + ADR-006 (5 reasoning engines: direct, react, plan-execute,
    // rewoo, reflexion) + workflow declarativo (SDR cadence) + request-human
    // (STOP/handoff). `workflow` adicionado em 2026-06-02 (auditoria CRÍT #4):
    // o harness emite-o quando um agente declara workflow (caminho vivo SDR no
    // piloto). `failed` é o sentinel de error boundary.
    strategy: z.enum([
      "direct",
      "react",
      "plan-execute",
      "rewoo",
      "workflow",
      "request-human",
      "failed",
    ]),
    usage: z.object({
      prompt_tokens: z.number().int().nonnegative(),
      completion_tokens: z.number().int().nonnegative(),
    }),
    proposals: z.array(ProposalSchema).optional(),
  })
  .passthrough();

export type CompleteCallback = z.infer<typeof CompleteCallbackSchema>;
