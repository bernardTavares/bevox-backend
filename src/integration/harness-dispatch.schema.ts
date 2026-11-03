/**
 * `DispatchPayloadSchema` — mirror of canon **PRD §10.4 `DispatchPayload`**,
 * the documented backend↔harness dispatch contract. Backend conformance is
 * to §10.4 (the fields/types below are correct against it).
 *
 * The §10.4 tenant field is `organization_id` (UUID). The harness is
 * `organization_id`-native (ADR-019; canon `30_adr/bevox-harness/ADR-019`
 * + `_shared/ADR-021` + `_shared/ADR-016`): the same UUID denotes the same
 * tenant on both sides, with NO translation. The backend value is the org
 * UUID itself — no bridge.
 */

import { z } from "zod";

const Uuid = z.string().uuid();

export const ExecutionModeSchema = z.enum(["manual_assisted", "copilot", "autonomous_supervised"]);

export const DispatchMessageSchema = z.object({
  role: z.enum(["user", "assistant", "system"]),
  content: z.string(),
  message_id: Uuid.optional(),
});

export const DispatchPayloadSchema = z.object({
  execution_id: Uuid,
  execution_token: z.string().regex(/^[0-9a-f]{64}$/, "must be 64 hex chars"),
  callback_base_url: z.string().url(),
  organization_id: Uuid,
  execution_mode: ExecutionModeSchema,
  conversation: z.object({
    id: Uuid,
    channel_account_id: Uuid,
  }),
  // M5-P3c follow-on (media-only-dispatch-empty-messages): the harness
  // must NEVER be invoked with an empty conversation. A dispatch built
  // from a media-only inbound (no text rows) would historically produce
  // `messages: []` because `buildDispatchMessages` filters on
  // `content_text IS NOT NULL` — the IA would be triggered with no
  // content. The schema is the last line of defense at the wire and
  // refuses such payloads (`buildDispatchMessages` itself also throws a
  // semantic error before reaching this point; this guard catches any
  // future caller that bypasses the repository helper).
  messages: z.array(DispatchMessageSchema).min(1, "dispatch must include at least one message"),
  context: z.object({
    timezone: z.string().min(1),
    locale: z.string().min(1),
  }),
  agent_config: z.object({
    default_model: z.string().min(1),
    system_prompt: z.string(),
  }),
  skills: z.array(z.string()).default([]),
  // Dispatch-contract amendment (PRD §10.4, aceito 2026-06-03). Absolute
  // wall-clock deadline in epoch ms = dispatched_at(DB) + processing_timeout_ms.
  // Lets the harness anchor its budget to the backend clock instead of the
  // handler start time, which drifts across BullMQ retries. Optional/additive.
  deadline_ms: z.number().int().positive().optional(),
  // Replay-only: root of the replay lineage (executions.original_execution_id
  // ?? executions.id). Stabilizes the harness idempotency-key across staff
  // replays (which mint a fresh execution_id) so external mutations dedup.
  original_execution_id: Uuid.optional(),
});

export type DispatchPayload = z.infer<typeof DispatchPayloadSchema>;
