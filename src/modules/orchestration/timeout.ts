/**
 * Timeout scan handler — repeat job. Atomically claims executions whose
 * processing deadline passed (status → timeout), releases the
 * per-conversation guard, and hands the conversation to the generic
 * human queue (status='waiting_human', owner='queue') + AuditEvent.
 * Specific-attendant assignment (ConversationAssignment/HandoffEvent) is
 * Módulo 7 — out of scope (spec §5/§9). Zero external provider call.
 */

import { claimTimedOutExecutions, handoffConversationOnTimeout } from "./repository.js";

export async function handleTimeoutScan(): Promise<void> {
  const timedOut = await claimTimedOutExecutions();
  for (const e of timedOut) {
    await handoffConversationOnTimeout(e);
  }
}
