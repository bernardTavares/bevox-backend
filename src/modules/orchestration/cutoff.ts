/**
 * Cutoff handler — fires when a buffer window's delay elapses. Idempotent
 * (debounce: stale job sees non-open window → no-op). Claims the
 * per-conversation guard (CAS), resolves execution_mode (D) +
 * agent_config, builds messages, calls the Marco-1 dispatchExecution,
 * fills the guard with the new execution, closes the window. On dispatch
 * failure releases the claim. D provides resolveExecutionMode; B2 never
 * stamps Execution or publishes the harness queue itself.
 */

import type { Job } from "bullmq";

import { env } from "@/config/env.js";
import { dispatchExecution } from "@/integration/harness-dispatcher.js";
import { resolveExecutionMode } from "@/modules/autonomy/resolver.js";

import { CUTOFF_CLAIM_LEASE_MS } from "./constants.js";
import {
  buildDispatchMessages,
  claimPipelineForCutoff,
  closeBufferWindow,
  fillPipelineActiveExecution,
  getOrCreateAgentConfig,
  getOrgContext,
  getPromotableWindow,
  releasePipelineClaim,
} from "./repository.js";

export interface CutoffJob {
  buffer_window_id: string;
  conversation_id: string;
}

export async function handleCutoff(job: Job<CutoffJob>): Promise<void> {
  const { buffer_window_id, conversation_id } = job.data;

  const win = await getPromotableWindow(buffer_window_id);
  if (!win) return; // debounce: window extended/closed → newer job owns it

  const claim = await claimPipelineForCutoff({
    conversationId: conversation_id,
    leaseOwner: `cutoff:${buffer_window_id}`,
    leaseMs: CUTOFF_CLAIM_LEASE_MS,
  });
  if (!claim.claimed) return; // active execution OR concurrent cutoff won

  let dispatched: { execution_id: string } | null = null;
  try {
    const executionMode = await resolveExecutionMode({
      organizationId: claim.organizationId,
      channelConnectionId: claim.channelConnectionId,
    });
    const agent = await getOrCreateAgentConfig(claim.organizationId);
    const messages = await buildDispatchMessages(win.conversationKey);
    const orgCtx = await getOrgContext(claim.organizationId);

    const result = await dispatchExecution({
      organizationId: claim.organizationId,
      executionMode,
      conversation: {
        id: conversation_id,
        // ADR-019: the harness is organization_id-native; channel_account_id
        // is contextual, not an auth/routing key. Falling back to
        // conversation_id when channelConnectionId is null satisfies the
        // non-null contract without inventing data (org boundary carried by
        // organization_id).
        channel_account_id: claim.channelConnectionId ?? conversation_id,
      },
      messages,
      context: { timezone: orgCtx.timezone, locale: orgCtx.locale },
      agentConfig: {
        default_model: agent.default_model ?? env().DEFAULT_LLM_MODEL,
        system_prompt: agent.system_prompt,
      },
      skills: [],
    });
    dispatched = { execution_id: result.execution_id };

    await fillPipelineActiveExecution({
      conversationId: conversation_id,
      executionId: result.execution_id,
    });
    await closeBufferWindow({
      bufferWindowId: buffer_window_id,
      executionId: result.execution_id,
      status: "dispatching",
    });
  } catch (err) {
    if (dispatched) {
      // Dispatch already created the execution + enqueued the harness job
      // (it WILL run). Only post-dispatch bookkeeping failed. Do NOT
      // release the guard (a live execution exists → releasing risks
      // double-dispatch) and do NOT error-close the window. Best-effort
      // re-apply the bookkeeping; rethrow so BullMQ retries. The residual
      // (fill never lands → lease-expiry could re-dispatch) collapses into
      // the documented claimPipelineForCutoff lease-recovery residual race.
      try {
        await fillPipelineActiveExecution({
          conversationId: conversation_id,
          executionId: dispatched.execution_id,
        });
        await closeBufferWindow({
          bufferWindowId: buffer_window_id,
          executionId: dispatched.execution_id,
          status: "dispatching",
        });
      } catch {
        // swallow; original error is rethrown below
      }
      throw err;
    }
    // Pre-dispatch failure: no execution exists. Release the claim so a
    // future inbound message can re-promote; error-close the window.
    // (The rethrow records the failure for observability; recovery is via
    // a subsequent inbound — buildDispatchMessages keys by conversation_key
    // so re-buffered messages are not lost. BullMQ retry itself no-ops
    // because the window is now closed.)
    await releasePipelineClaim(conversation_id);
    await closeBufferWindow({
      bufferWindowId: buffer_window_id,
      executionId: null,
      status: "error",
    });
    throw err;
  }
}
