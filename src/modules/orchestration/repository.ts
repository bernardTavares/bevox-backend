/**
 * Repository — orchestration module. getDb() parameterized SQL (repo
 * convention; no static @db import). Pure DB ops driven by the 3
 * workers. Concurrency guard = conversation_pipeline_state `version`
 * (text optimistic lock) + lease_owner/lease_expires_at claim, then
 * active_execution_id fill (A's table; no new column).
 */

import { sql } from "drizzle-orm";

import { getDb } from "@/db/client.js";
import { parseRoutingConfig } from "@/modules/channels/routing-config.schema.js";
import { uuidv7 } from "@/shared/uuid.js";

import { DEFAULT_SYSTEM_PROMPT } from "./constants.js";

/** incoming → user; outgoing → assistant; anything else → user. */
export function directionToRole(direction: string): "user" | "assistant" {
  return direction === "outgoing" ? "assistant" : "user";
}

/** Buffer seconds: channel routing_config (if buffer_enabled !== false) > env default. */
export function resolveBufferSeconds(
  routingConfigJson: unknown,
  envDefaultSeconds: number,
): number {
  const cfg = parseRoutingConfig(routingConfigJson);
  if (cfg.buffer_enabled === false) return envDefaultSeconds;
  if (typeof cfg.buffer_cutoff_seconds === "number" && cfg.buffer_cutoff_seconds > 0) {
    return cfg.buffer_cutoff_seconds;
  }
  return envDefaultSeconds;
}

export interface ConversationContext {
  conversationId: string;
  pipelineVersion: string;
  organizationId: string;
  channelConnectionId: string | null;
  timezone: string;
  locale: string;
}

export async function upsertConversationAndPipeline(input: {
  conversationKey: string;
  organizationId: string;
  channelConnectionId: string | null;
  externalConversationId: string | null;
  customerId: string;
  customerChannelId: string;
}): Promise<ConversationContext> {
  const db = getDb();
  const existing = await db.execute(
    sql`SELECT cps.conversation_id, cps.version
        FROM conversation_pipeline_state cps
        WHERE cps.conversation_key = ${input.conversationKey} LIMIT 1`,
  );
  const hit = existing.rows[0] as { conversation_id: string; version: string } | undefined;

  let conversationId: string;
  let version: string;
  if (hit) {
    conversationId = hit.conversation_id;
    version = hit.version;
    await db.execute(
      sql`UPDATE conversations SET last_message_at = now(), updated_at = now()
          WHERE id = ${conversationId}`,
    );
  } else {
    conversationId = uuidv7();
    await db.execute(
      sql`INSERT INTO conversations
            (id, organization_id, customer_id, channel_connection_id,
             customer_channel_id, status, current_owner_type, last_message_at)
          VALUES (${conversationId}, ${input.organizationId}, ${input.customerId},
                  ${input.channelConnectionId}, ${input.customerChannelId},
                  'open', 'ai', now())
          ON CONFLICT DO NOTHING`,
    );
    const pipelineId = uuidv7();
    await db.execute(
      sql`INSERT INTO conversation_pipeline_state
            (id, organization_id, conversation_id, conversation_key,
             external_conversation_id, pipeline_status, version)
          VALUES (${pipelineId}, ${input.organizationId}, ${conversationId},
                  ${input.conversationKey}, ${input.externalConversationId},
                  'buffering', '1')
          ON CONFLICT (conversation_key) DO NOTHING`,
    );
    const reread = await db.execute(
      sql`SELECT conversation_id, version FROM conversation_pipeline_state
          WHERE conversation_key = ${input.conversationKey} LIMIT 1`,
    );
    const row = reread.rows[0] as { conversation_id: string; version: string } | undefined;
    if (!row) throw new Error("conversation_pipeline_state vanished after upsert");
    conversationId = row.conversation_id;
    version = row.version;
  }

  const orgRow = await db.execute(
    sql`SELECT timezone, locale FROM organizations WHERE id = ${input.organizationId} LIMIT 1`,
  );
  const org = orgRow.rows[0] as { timezone: string; locale: string };
  return {
    conversationId,
    pipelineVersion: version,
    organizationId: input.organizationId,
    channelConnectionId: input.channelConnectionId,
    timezone: org.timezone,
    locale: org.locale,
  };
}

export async function openOrExtendBufferWindow(input: {
  conversationId: string;
  conversationKey: string;
  organizationId: string;
  channelConnectionId: string | null;
  bufferSeconds: number;
}): Promise<{ bufferWindowId: string; isNew: boolean }> {
  const db = getDb();
  const open = await db.execute(
    sql`SELECT id FROM buffer_windows
        WHERE conversation_id = ${input.conversationId} AND state = 'open'
        ORDER BY window_sequence DESC LIMIT 1`,
  );
  const openRow = open.rows[0] as { id: string } | undefined;
  if (openRow) {
    await db.execute(
      sql`UPDATE buffer_windows
          SET message_count = message_count + 1,
              cutoff_at = now() + (${input.bufferSeconds} * interval '1 second')
          WHERE id = ${openRow.id}`,
    );
    return { bufferWindowId: openRow.id, isNew: false };
  }
  const seqRow = await db.execute(
    sql`SELECT COALESCE(MAX(window_sequence), 0) + 1 AS next_seq
        FROM buffer_windows WHERE conversation_id = ${input.conversationId}`,
  );
  const nextSeq = Number((seqRow.rows[0] as { next_seq: number }).next_seq);
  const windowId = uuidv7();
  await db.execute(
    sql`INSERT INTO buffer_windows
          (id, organization_id, channel_connection_id, conversation_id,
           conversation_key, window_sequence, state, cutoff_at, message_count)
        VALUES (${windowId}, ${input.organizationId}, ${input.channelConnectionId},
                ${input.conversationId}, ${input.conversationKey}, ${nextSeq},
                'open', now() + (${input.bufferSeconds} * interval '1 second'), 1)`,
  );
  return { bufferWindowId: windowId, isNew: true };
}

export async function getPromotableWindow(
  bufferWindowId: string,
): Promise<{ conversationId: string; conversationKey: string } | null> {
  const res = await getDb().execute(
    sql`SELECT conversation_id, conversation_key FROM buffer_windows
        WHERE id = ${bufferWindowId} AND state = 'open' LIMIT 1`,
  );
  const r = res.rows[0] as { conversation_id: string; conversation_key: string } | undefined;
  return r ? { conversationId: r.conversation_id, conversationKey: r.conversation_key } : null;
}

/**
 * Compare-and-swap claim of the pipeline for cutoff dispatch. The CAS is a
 * single atomic UPDATE (the prior SELECT only seeds the expected version);
 * it guarantees exactly one of two concurrent same-conversation cutoffs
 * wins. The lease-expiry predicate (lease_expires_at < now()) is intended
 * stuck-conversation recovery.
 *
 * RESIDUAL RACE (V1-accepted, follow-on): a slow-but-alive first worker
 * whose lease expired before fillPipelineActiveExecution can be overtaken
 * by a new claimant → rare double-dispatch; bounded by CUTOFF_CLAIM_LEASE_MS;
 * fencing-token hardening is a tracked follow-on.
 */
export async function claimPipelineForCutoff(input: {
  conversationId: string;
  leaseOwner: string;
  leaseMs: number;
}): Promise<{ claimed: boolean; organizationId: string; channelConnectionId: string | null }> {
  const db = getDb();
  const cur = await db.execute(
    sql`SELECT version, organization_id FROM conversation_pipeline_state
        WHERE conversation_id = ${input.conversationId} LIMIT 1`,
  );
  const c = cur.rows[0] as { version: string; organization_id: string } | undefined;
  if (!c) return { claimed: false, organizationId: "", channelConnectionId: null };
  const upd = await db.execute(
    sql`UPDATE conversation_pipeline_state
        SET version = (CAST(version AS bigint) + 1)::text, lease_owner = ${input.leaseOwner},
            lease_expires_at = now() + (${input.leaseMs} / 1000.0 * interval '1 second'),
            pipeline_status = 'dispatching', updated_at = now()
        WHERE conversation_id = ${input.conversationId}
          AND version = ${c.version}
          AND active_execution_id IS NULL
          AND (lease_expires_at IS NULL OR lease_expires_at < now())
        RETURNING id`,
  );
  if (upd.rows.length === 0) {
    return { claimed: false, organizationId: c.organization_id, channelConnectionId: null };
  }
  const cc = await db.execute(
    sql`SELECT channel_connection_id FROM conversations WHERE id = ${input.conversationId} LIMIT 1`,
  );
  const ccRow = cc.rows[0] as { channel_connection_id: string | null } | undefined;
  return {
    claimed: true,
    organizationId: c.organization_id,
    channelConnectionId: ccRow?.channel_connection_id ?? null,
  };
}

export async function fillPipelineActiveExecution(input: {
  conversationId: string;
  executionId: string;
}): Promise<void> {
  await getDb().execute(
    sql`UPDATE conversation_pipeline_state
        SET active_execution_id = ${input.executionId},
            version = (CAST(version AS bigint) + 1)::text,
            lease_owner = NULL, lease_expires_at = NULL,
            pipeline_status = 'processing', updated_at = now()
        WHERE conversation_id = ${input.conversationId}`,
  );
}

export async function releasePipelineClaim(conversationId: string): Promise<void> {
  await getDb().execute(
    sql`UPDATE conversation_pipeline_state
        SET active_execution_id = NULL,
            version = (CAST(version AS bigint) + 1)::text,
            lease_owner = NULL, lease_expires_at = NULL,
            pipeline_status = 'error', updated_at = now()
        WHERE conversation_id = ${conversationId}`,
  );
}

export async function closeBufferWindow(input: {
  bufferWindowId: string;
  executionId: string | null;
  status: string;
}): Promise<void> {
  await getDb().execute(
    sql`UPDATE buffer_windows
        SET state = 'closed', closed_at = now(),
            latest_execution_id = ${input.executionId},
            latest_execution_status = ${input.status}
        WHERE id = ${input.bufferWindowId}`,
  );
}

export async function getOrCreateAgentConfig(
  organizationId: string,
): Promise<{ system_prompt: string; default_model: string | null }> {
  const db = getDb();
  const found = await db.execute(
    sql`SELECT system_prompt, default_model FROM agent_configs
        WHERE organization_id = ${organizationId} LIMIT 1`,
  );
  const hit = found.rows[0] as { system_prompt: string; default_model: string | null } | undefined;
  if (hit) return hit;
  await db.execute(
    sql`INSERT INTO agent_configs (organization_id, system_prompt)
        VALUES (${organizationId}, ${DEFAULT_SYSTEM_PROMPT})
        ON CONFLICT (organization_id) DO NOTHING`,
  );
  const re = await db.execute(
    sql`SELECT system_prompt, default_model FROM agent_configs
        WHERE organization_id = ${organizationId} LIMIT 1`,
  );
  return re.rows[0] as { system_prompt: string; default_model: string | null };
}

/**
 * Stable per-CONTACT identity extraído do sender_snapshot_json persistido
 * pelo inbound handler. Cobre canon §8.2 (`customer_channels.external_user_id`
 * = o CONTATO, não a conversa) **e** o caminho de outbound: o `phoneNumber`
 * é o que o `deliverToChannel` (`executions/seams.ts`) usa para enviar a
 * resposta da IA via meta-api — sem isto, o outbound resolve `customerPhone`
 * como `NULL` e retorna `skipped_missing_recipient`, dropando a resposta
 * silenciosamente. Ver auditoria 2026-06-02 CRÍT #1.
 *
 * Shapes esperados (gravados por `metaapi/inbound-dispatch.ts`):
 * - WhatsApp: `contacts[0]` = `{wa_id: "5511999...", profile: {name?}}` — o
 *   `wa_id` é E.164 sem `+`. Prefixamos `+` para alinhar com o resto do
 *   sistema.
 * - Instagram: `sender` = `{id: "12345"}` — sem telefone, sem nome.
 *
 * Retorna null para eventos sem sender (status/assignment).
 */
export interface SenderSnapshot {
  contactId: string;
  /** E.164 com `+` (WA only — IG não tem telefone). */
  phoneNumber: string | null;
  displayName: string | null;
}

/**
 * Pura: extrai a identidade do contato do payload bruto do snapshot do
 * sender persistido em `message_records.sender_snapshot_json`. Separada
 * de `getSenderSnapshot` para teste unitário sem DB.
 *
 * Shapes esperados (gravados por `metaapi/inbound-dispatch.ts`):
 * - WhatsApp: `contacts[0]` = `{wa_id, profile?: {name?}}` — `wa_id` é
 *   E.164 sem `+`. Prefixamos `+` para alinhar com o resto do sistema.
 * - Instagram: `sender` = `{id}` — sem telefone, sem profile aqui.
 */
export function parseSenderSnapshot(
  snap: Record<string, unknown> | null | undefined,
): SenderSnapshot | null {
  if (!snap || typeof snap !== "object") return null;

  // WhatsApp first: `wa_id` é o identificador canônico do contato + telefone.
  const waId = typeof snap.wa_id === "string" ? snap.wa_id : null;
  if (waId) {
    const profile = (snap.profile as Record<string, unknown> | undefined) ?? undefined;
    const name = profile && typeof profile.name === "string" ? profile.name : null;
    return {
      contactId: waId,
      phoneNumber: waId.startsWith("+") ? waId : `+${waId}`,
      displayName: name,
    };
  }

  // Instagram fallback: `id` (PSID). Sem telefone, sem profile aqui.
  const igId = typeof snap.id === "string" ? snap.id : null;
  if (igId) {
    return { contactId: igId, phoneNumber: null, displayName: null };
  }

  return null;
}

export async function getSenderSnapshot(receivedEventId: string): Promise<SenderSnapshot | null> {
  const res = await getDb().execute(
    sql`SELECT sender_snapshot_json AS snapshot
        FROM message_records
        WHERE received_event_id = ${receivedEventId}
          AND sender_snapshot_json IS NOT NULL
        ORDER BY message_created_at DESC NULLS LAST
        LIMIT 1`,
  );
  const row = res.rows[0] as { snapshot: Record<string, unknown> | null } | undefined;
  return parseSenderSnapshot(row?.snapshot ?? null);
}

/** @deprecated Usar `getSenderSnapshot` (que também extrai phone+displayName). */
export async function getSenderContactId(receivedEventId: string): Promise<string | null> {
  const snap = await getSenderSnapshot(receivedEventId);
  return snap?.contactId ?? null;
}

export async function getOrgContext(
  organizationId: string,
): Promise<{ timezone: string; locale: string }> {
  const res = await getDb().execute(
    sql`SELECT timezone, locale FROM organizations WHERE id = ${organizationId} LIMIT 1`,
  );
  const row = res.rows[0] as { timezone: string; locale: string } | undefined;
  if (!row) throw new Error(`organization ${organizationId} not found`);
  return row;
}

/**
 * Thrown by `buildDispatchMessages` when the conversation has no text
 * messages to dispatch (e.g. a buffer window containing only media
 * inbounds — `content_text IS NOT NULL` filters them out). Callers
 * (cutoff handler, staff redispatch) must catch this and abort the
 * dispatch — invoking the harness with `messages: []` would trigger an
 * IA execution with no content (M5-P3c gap
 * `media-only-dispatch-empty-messages`). The wire schema also rejects
 * empty arrays as a last line of defense.
 *
 * V1 contract: surface a typed error rather than silently dropping the
 * dispatch; the multi-modal enrichment (media URL inclusion +
 * `buildDispatchMessages` rewrite) is a tracked follow-on.
 */
export class EmptyDispatchMessagesError extends Error {
  readonly conversationKey: string;
  constructor(conversationKey: string) {
    super(
      `no text content available to dispatch for conversation_key=${conversationKey} ` +
        `(all buffered messages are media-only); dispatch refused`,
    );
    this.name = "EmptyDispatchMessagesError";
    this.conversationKey = conversationKey;
  }
}

export async function buildDispatchMessages(
  conversationKey: string,
): Promise<Array<{ role: "user" | "assistant"; content: string; message_id: string }>> {
  const res = await getDb().execute(
    sql`SELECT external_message_id, direction, content_text
        FROM message_records
        WHERE conversation_key = ${conversationKey} AND content_text IS NOT NULL
        ORDER BY message_created_at ASC NULLS LAST, external_message_id ASC`,
  );
  const messages = (
    res.rows as unknown as Array<{
      external_message_id: string;
      direction: string;
      content_text: string;
    }>
  ).map((m) => ({
    role: directionToRole(m.direction),
    content: m.content_text,
    message_id: m.external_message_id,
  }));
  if (messages.length === 0) {
    throw new EmptyDispatchMessagesError(conversationKey);
  }
  return messages;
}

export interface TimedOutExecution {
  executionId: string;
  conversationId: string;
  organizationId: string;
}

export async function claimTimedOutExecutions(): Promise<TimedOutExecution[]> {
  const res = await getDb().execute(
    sql`UPDATE executions SET status = 'timeout', updated_at = now()
        WHERE id IN (
          SELECT id FROM executions
          WHERE status IN ('dispatching','processing','waiting_input')
            AND dispatched_at IS NOT NULL
            AND dispatched_at + (processing_timeout_ms * interval '1 millisecond') < now()
          LIMIT 200
        )
        RETURNING id, organization_id, conversation_id`,
  );
  return (
    res.rows as unknown as Array<{
      id: string;
      organization_id: string;
      conversation_id: string;
    }>
  ).map((r) => ({
    executionId: r.id,
    organizationId: r.organization_id,
    conversationId: r.conversation_id,
  }));
}

/**
 * Performs THREE sequential writes with NO transaction (no tx helper
 * exists in the codebase — same pattern as C's resolveOrCreateCustomerChannel
 * / D's applyProfilePatch): (1) conversation_pipeline_state → 'timeout' +
 * lease/guard released, (2) conversations → waiting_human/queue, (3)
 * audit_events insert. Partial-failure window: a crash after (1)/(2) hands
 * the conversation to the human queue WITHOUT the corresponding audit_events
 * row — 'conversation.handoff_timeout' is an auditable sensitive state
 * transition (parity with D's PRD §5.5 concern). Follow-on: wrap the 3
 * writes in a transaction once a tx helper exists (B2 pipeline tx follow-on,
 * tracked).
 */
export async function handoffConversationOnTimeout(e: TimedOutExecution): Promise<void> {
  const db = getDb();
  await db.execute(
    sql`UPDATE conversation_pipeline_state
        SET active_execution_id = NULL,
            version = (CAST(version AS bigint) + 1)::text,
            lease_owner = NULL, lease_expires_at = NULL,
            pipeline_status = 'timeout', updated_at = now()
        WHERE conversation_id = ${e.conversationId}`,
  );
  await db.execute(
    sql`UPDATE conversations
        SET status = 'waiting_human', current_owner_type = 'queue',
            current_owner_id = NULL, updated_at = now()
        WHERE id = ${e.conversationId}`,
  );
  const auditId = uuidv7();
  await db.execute(
    sql`INSERT INTO audit_events
          (id, organization_id, entity_type, entity_id, action,
           actor_type, execution_id, after_json)
        VALUES (${auditId}, ${e.organizationId}, 'conversation', ${e.conversationId},
                'conversation.handoff_timeout', 'system', ${e.executionId},
                ${JSON.stringify({ reason: "execution_timeout" })}::jsonb)`,
  );
}
