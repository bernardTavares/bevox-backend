/**
 * BullMQ producer — backend → bevox-harness dispatch (PRD §10.4, ADR-008).
 *
 * Responsibilities:
 *   1. Mint an execution token (64 hex), persist SHA-256(token) in
 *      `executions.execution_token_hash`.
 *   2. Create the `executions` row (status pending → dispatching).
 *   3. Build the wire `DispatchPayload`; the tenant field is
 *      `organization_id` carrying the org UUID directly (the harness is
 *      organization_id-native per ADR-019 — no translation).
 *   4. Validate the outgoing payload against `DispatchPayloadSchema`.
 *   5. Enqueue to `EXECUTION_DISPATCH_QUEUE` with jobId = execution_id
 *      (idempotent enqueue; UUIDv7 from src/shared/uuid.ts).
 *
 * Runtime SQL via getDb() (no static @db import — preserves the flat-dist
 * alias gate, R3).
 */

import { createHash, randomBytes } from "node:crypto";

import { sql } from "drizzle-orm";

import { env } from "@/config/env.js";
import { getDb } from "@/db/client.js";
import { EXECUTION_DISPATCH_QUEUE, getExecutionDispatchQueue } from "@/lib/queues.js";
import { uuidv7 } from "@/shared/uuid.js";

import { DispatchPayloadSchema, type DispatchPayload } from "./harness-dispatch.schema.js";

const PROCESSING_TIMEOUT_MS = 120_000;

export interface DispatchInput {
  organizationId: string;
  executionMode: "manual_assisted" | "copilot" | "autonomous_supervised";
  conversation: { id: string; channel_account_id: string };
  messages: Array<{ role: "user" | "assistant" | "system"; content: string; message_id?: string }>;
  context: { timezone: string; locale: string };
  agentConfig: { default_model: string; system_prompt: string };
  skills?: string[];
  // Dispatch-contract amendment (PRD §10.4, aceito 2026-06-03): replay-only.
  // The ROOT of the replay lineage. When set, it is persisted on the new
  // executions row and sent on the wire so the harness can dedup external
  // mutations against the original execution.
  originalExecutionId?: string;
}

export interface DispatchResult {
  execution_id: string;
  payload: DispatchPayload;
}

function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

/**
 * Creates an execution + enqueues its dispatch job. Returns the wire
 * payload (already schema-validated) and the execution_id. The plaintext
 * token leaves only on the wire payload; the DB stores only the hash.
 */
export async function dispatchExecution(input: DispatchInput): Promise<DispatchResult> {
  const cfg = env();
  const executionId = uuidv7();
  const token = randomBytes(32).toString("hex"); // 64 hex chars
  const tokenHash = sha256(token);

  const db = getDb();

  // 1+2. Create the executions row (pending) then mark dispatching.
  //       RETURNING dispatched_at so the absolute wall-clock deadline is
  //       derived from the DB clock (the same clock the timeout-scan compares
  //       against), avoiding app-vs-DB skew.
  const insRes = await db.execute(
    sql`INSERT INTO executions
          (id, organization_id, conversation_id, execution_mode, status,
           execution_token_hash, processing_endpoint_url, processing_timeout_ms,
           dispatched_at, original_execution_id)
        VALUES (${executionId}, ${input.organizationId}, ${input.conversation.id},
                ${input.executionMode}, 'pending', ${tokenHash},
                ${cfg.HARNESS_CALLBACK_BASE_URL}, ${PROCESSING_TIMEOUT_MS}, now(),
                ${input.originalExecutionId ?? null})
        RETURNING dispatched_at`,
  );
  const dispatchedAt = (insRes.rows[0] as { dispatched_at: Date | string }).dispatched_at;
  const deadlineMs = new Date(dispatchedAt).getTime() + PROCESSING_TIMEOUT_MS;

  // 3. Build the wire payload. The harness is organization_id-native
  //    (ADR-019): the org UUID is set directly, no translation.
  //    deadline_ms (absolute epoch ms) + original_execution_id are the
  //    dispatch-contract amendment fields (PRD §10.4, aceito 2026-06-03).
  const payload: DispatchPayload = DispatchPayloadSchema.parse({
    execution_id: executionId,
    execution_token: token,
    callback_base_url: cfg.HARNESS_CALLBACK_BASE_URL,
    organization_id: input.organizationId,
    execution_mode: input.executionMode,
    conversation: input.conversation,
    messages: input.messages,
    context: input.context,
    agent_config: input.agentConfig,
    skills: input.skills ?? [],
    deadline_ms: deadlineMs,
    original_execution_id: input.originalExecutionId,
  });

  // 5. Enqueue (jobId = execution_id → idempotent enqueue).
  await getExecutionDispatchQueue().add(EXECUTION_DISPATCH_QUEUE, payload, {
    jobId: executionId,
  });

  await db.execute(
    sql`UPDATE executions SET status = 'dispatching', updated_at = now()
         WHERE id = ${executionId} AND status = 'pending'`,
  );

  return { execution_id: executionId, payload };
}
