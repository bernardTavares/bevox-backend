/**
 * Intake handler — consumes bevox.ingestion.event (B1). Resolves channel
 * + customer (C seam), upserts conversation+pipeline, opens/extends the
 * buffer window (debounce), schedules the delayed cutoff job. Idempotent
 * by conversation_key.
 */

import type { Job } from "bullmq";

import { env } from "@/config/env.js";
import { getBufferCutoffQueue } from "@/lib/queues.js";
import {
  findChannelConnection,
  resolveOrCreateCustomerChannel,
} from "@/modules/channels/repository.js";

import { CUTOFF_JOB_NAME } from "./constants.js";
import {
  getSenderSnapshot,
  openOrExtendBufferWindow,
  resolveBufferSeconds,
  upsertConversationAndPipeline,
} from "./repository.js";

export interface IngestionEventJob {
  received_event_id: string;
  conversation_key: string;
  event_type: string;
  organization_id: string;
  external_account_id: string;
}

/**
 * conversation_key canonical format (Marco 4 P4+):
 *   "channel:{provider}:{external_account_id}:{external_conversation_id}" (4-segment).
 *
 * Defensive fallback returns parts[0] verbatim as provider quando key
 * malformado — preserves P3 regression test #5 (`'garbage'`) e #6 (`''`)
 * assertions sem mudar semantics observáveis.
 */
export function parseConversationKey(key: string): {
  provider: string;
  externalConversationId: string | null;
} {
  const parts = key.split(":");
  if (parts[0] === "channel" && parts.length >= 4) {
    return {
      provider: parts[1] ?? "unknown",
      externalConversationId: parts.slice(3).join(":"),
    };
  }
  // Defensive fallback (malformed key): provider verbatim, null convId.
  return {
    provider: parts[0] ?? "",
    externalConversationId: null,
  };
}

export async function handleIngestionEvent(job: Job<IngestionEventJob>): Promise<void> {
  const data = job.data;
  const { provider, externalConversationId } = parseConversationKey(data.conversation_key);

  const channel = await findChannelConnection(provider, data.external_account_id);
  if (!channel) return; // unknown channel: B1 already 401s at ingress; defensive no-op

  const senderSnapshot = await getSenderSnapshot(data.received_event_id);
  // Canon §8.2: dedup the Customer per CONTACT, not per conversation.
  // Inbound handler persists provider contact id em `message_records
  // .sender_snapshot_json` (WA `contacts[0].wa_id` ou IG `sender.id`).
  // Fallback to conversation_key only for sender-less events
  // (status/assignment) — degraded but safe.
  //
  // **Crítico para o outbound (auditoria 2026-06-02 CRÍT #1):** o
  // `phoneNumber` e `displayName` extraídos aqui populam
  // `customer_channels.phone_number`, que é o que `executions/seams.ts:
  // deliverToChannel` usa pra resolver o destinatário do envio outbound.
  // Sem eles, `customerPhone = primary_phone ?? channel_phone` resolve
  // NULL e o outbound retorna `skipped_missing_recipient` —
  // a resposta da IA nunca chega ao WhatsApp do cliente.
  const externalUserId = senderSnapshot?.contactId ?? data.conversation_key;

  const { customerId, customerChannelId } = await resolveOrCreateCustomerChannel({
    organizationId: data.organization_id,
    provider,
    externalUserId,
    displayName: senderSnapshot?.displayName ?? null,
    phoneNumber: senderSnapshot?.phoneNumber ?? null,
  });

  const ctx = await upsertConversationAndPipeline({
    conversationKey: data.conversation_key,
    organizationId: data.organization_id,
    channelConnectionId: channel.id,
    externalConversationId,
    customerId,
    customerChannelId,
  });

  const bufferSeconds = resolveBufferSeconds(
    channel.routing_config_json,
    env().BUFFER_CUTOFF_SECONDS,
  );

  const { bufferWindowId } = await openOrExtendBufferWindow({
    conversationId: ctx.conversationId,
    conversationKey: data.conversation_key,
    organizationId: data.organization_id,
    channelConnectionId: channel.id,
    bufferSeconds,
  });

  await getBufferCutoffQueue().add(
    CUTOFF_JOB_NAME,
    { buffer_window_id: bufferWindowId, conversation_id: ctx.conversationId },
    { delay: bufferSeconds * 1000, jobId: `cutoff:${bufferWindowId}` },
  );
}
