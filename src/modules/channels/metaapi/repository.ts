/**
 * Repository de channel_subscriptions + organization_meta_api_tenant — Marco 4 P1.
 *
 * SQL parametrizado via getDb().execute(sql``); sem import estático @/db/schema
 * (precedente bevox-backend/ADR-019 + Marco 3 pattern).
 * signing_secret cifrado em rest via src/lib/aead.ts.
 */

import { sql } from "drizzle-orm";

import { getDb } from "@/db/client.js";
import { encrypt, decrypt } from "@/lib/aead.js";
import { uuidv7 } from "@/shared/uuid.js";

export interface SubscriptionRow {
  id: string;
  appId: string;
  subscriptionId: string;
  url: string;
  signingSecret: string; // decrypted
  status: "active" | "paused" | "disabled";
  createdAt: Date;
}

interface SubscriptionDbRow {
  id: string;
  app_id: string;
  subscription_id: string;
  url: string;
  signing_secret_ciphertext: string;
  status: "active" | "paused" | "disabled";
  created_at: Date;
}

function mapSubscriptionRow(r: SubscriptionDbRow): SubscriptionRow {
  return {
    id: r.id,
    appId: r.app_id,
    subscriptionId: r.subscription_id,
    url: r.url,
    signingSecret: decrypt(r.signing_secret_ciphertext),
    status: r.status,
    createdAt: r.created_at,
  };
}

export async function findSubscriptionByUrl(url: string): Promise<SubscriptionRow | null> {
  const res = await getDb().execute(
    sql`SELECT id, app_id, subscription_id, url, signing_secret_ciphertext, status, created_at
          FROM channel_subscriptions
         WHERE url = ${url}
         LIMIT 1`,
  );
  const rows = res.rows as unknown as SubscriptionDbRow[];
  return rows.length === 0 ? null : mapSubscriptionRow(rows[0]!);
}

export async function findSubscriptionById(
  subscriptionId: string,
): Promise<SubscriptionRow | null> {
  const res = await getDb().execute(
    sql`SELECT id, app_id, subscription_id, url, signing_secret_ciphertext, status, created_at
          FROM channel_subscriptions
         WHERE subscription_id = ${subscriptionId}
         LIMIT 1`,
  );
  const rows = res.rows as unknown as SubscriptionDbRow[];
  return rows.length === 0 ? null : mapSubscriptionRow(rows[0]!);
}

export async function insertSubscription(input: {
  appId: string;
  subscriptionId: string;
  url: string;
  signingSecretPlaintext: string;
}): Promise<void> {
  const ciphertext = encrypt(input.signingSecretPlaintext);
  await getDb().execute(
    sql`INSERT INTO channel_subscriptions
          (id, app_id, subscription_id, url, signing_secret_ciphertext, status)
        VALUES (${uuidv7()}, ${input.appId}, ${input.subscriptionId}, ${input.url}, ${ciphertext}, 'active')
        ON CONFLICT (subscription_id) DO NOTHING`,
  );
}

export interface TenantMapping {
  organizationId: string;
  metaApiTenantId: string;
}

export async function findMetaApiTenant(organizationId: string): Promise<string | null> {
  const res = await getDb().execute(
    sql`SELECT meta_api_tenant_id FROM organization_meta_api_tenant
         WHERE organization_id = ${organizationId}
         LIMIT 1`,
  );
  const rows = res.rows as unknown as Array<{ meta_api_tenant_id: string }>;
  return rows[0]?.meta_api_tenant_id ?? null;
}

export async function findOrgByMetaApiTenant(metaApiTenantId: string): Promise<string | null> {
  const res = await getDb().execute(
    sql`SELECT organization_id FROM organization_meta_api_tenant
         WHERE meta_api_tenant_id = ${metaApiTenantId}
         LIMIT 1`,
  );
  const rows = res.rows as unknown as Array<{ organization_id: string }>;
  return rows[0]?.organization_id ?? null;
}

export async function insertTenantMapping(input: TenantMapping): Promise<void> {
  await getDb().execute(
    sql`INSERT INTO organization_meta_api_tenant (organization_id, meta_api_tenant_id)
        VALUES (${input.organizationId}, ${input.metaApiTenantId})
        ON CONFLICT (organization_id) DO NOTHING`,
  );
}

export async function listOrgsMissingMetaApiTenant(): Promise<string[]> {
  const res = await getDb().execute(
    sql`SELECT o.id FROM organizations o
        LEFT JOIN organization_meta_api_tenant omat ON o.id = omat.organization_id
        WHERE omat.meta_api_tenant_id IS NULL`,
  );
  const rows = res.rows as unknown as Array<{ id: string }>;
  return rows.map((r) => r.id);
}

export interface DeliveryContext {
  channelConnectionId: string | null;
  provider: "whatsapp" | "instagram" | null;
  externalAccountId: string | null;
  customerPhone: string | null;
  customerId: string | null;
  /**
   * Canonical conversation_key (Marco 4 P4+):
   *   "channel:{provider}:{external_account_id}:{external_conversation_id}"
   * Sourced from conversation_pipeline_state.conversation_key. Null when the
   * conversation has no pipeline row (synthetic test conversations or
   * conversations created outside the inbound webhook flow). Outbound
   * persistence (message_records direction='outgoing') uses this key; null
   * value disables outgoing persistence honestly rather than fabricating one.
   */
  conversationKey: string | null;
}

interface DeliveryContextRow {
  channel_connection_id: string | null;
  provider: string | null;
  external_account_id: string | null;
  customer_id: string | null;
  primary_phone: string | null;
  channel_phone: string | null;
  conversation_key: string | null;
}

/**
 * Resolve outbound delivery context for an execution.
 *
 * Joins: executions → conversations → channel_connections + customers
 *      → customer_channels (fallback phone for WA-onboarded customers
 *        sem primary_phone backfill).
 *
 * Parallels findExecutionContext (harness-callbacks.repository.ts:144) which
 * returns subset {conversation_id, channel_connection_id}; this lookup is
 * broader. Co-located em metaapi/ porque joins touch metaapi-outbound concerns.
 *
 * Returns null if execution row missing (orphan reference).
 */
export async function findExecutionDeliveryContext(
  executionId: string,
): Promise<DeliveryContext | null> {
  const res = await getDb().execute(
    sql`SELECT
          cc.id AS channel_connection_id,
          cc.provider AS provider,
          cc.external_account_id AS external_account_id,
          cu.id AS customer_id,
          cu.primary_phone AS primary_phone,
          ch.phone_number AS channel_phone,
          cps.conversation_key AS conversation_key
        FROM executions e
        JOIN conversations co ON co.id = e.conversation_id
        LEFT JOIN channel_connections cc ON cc.id = co.channel_connection_id
        LEFT JOIN customers cu ON cu.id = co.customer_id
        LEFT JOIN customer_channels ch
          ON ch.customer_id = cu.id
         AND ch.provider = cc.provider
         AND ch.is_primary = TRUE
        LEFT JOIN conversation_pipeline_state cps ON cps.conversation_id = co.id
        WHERE e.id = ${executionId}
        LIMIT 1`,
  );
  const rows = res.rows as unknown as DeliveryContextRow[];
  if (rows.length === 0) return null;
  const r = rows[0]!;
  const provider = r.provider === "whatsapp" || r.provider === "instagram" ? r.provider : null;
  return {
    channelConnectionId: r.channel_connection_id,
    provider,
    externalAccountId: r.external_account_id,
    customerId: r.customer_id,
    // primary_phone PRIMARY; customer_channels.phone_number fallback (per spec §3.8)
    customerPhone: r.primary_phone ?? r.channel_phone,
    conversationKey: r.conversation_key,
  };
}

export interface MessageAuditInput {
  organizationId: string;
  executionId: string;
  conversationId: string;
  action: "metaapi.send.success" | "metaapi.send.error" | "metaapi.send.skipped";
  channel: string | null;
  messageId?: string;
  providerMessageId?: string;
  errorCode?: string;
  reason?: string;
  attemptCount: number;
}

/**
 * Write outbound send audit row.
 *
 * Sibling precedent: insertChargeAudit (payments/repository.ts:288-299) +
 * P1 inbound audit (channels/metaapi/routes.ts:215). Conventions:
 *  - entity_type='metaapi_send' (mirror P1 'metaapi_event' pair)
 *  - actor_type='system' (autonomous backend operation)
 *  - entity_id = executionId always (uniform chain queryable)
 *  - messageId em after_json (not entity_id)
 */
export async function insertMessageAudit(input: MessageAuditInput): Promise<void> {
  const afterJson = {
    channel: input.channel,
    message_id: input.messageId ?? null,
    provider_message_id: input.providerMessageId ?? null,
    error_code: input.errorCode ?? null,
    reason: input.reason ?? null,
    attempt_count: input.attemptCount,
    conversation_id: input.conversationId,
  };
  await getDb().execute(
    sql`INSERT INTO audit_events
          (id, organization_id, entity_type, entity_id, action, actor_type, after_json)
        VALUES (${uuidv7()}, ${input.organizationId}, 'metaapi_send',
                ${input.executionId}, ${input.action}, 'system',
                ${JSON.stringify(afterJson)}::jsonb)`,
  );
}

export interface MessageRecordInsert {
  /**
   * Envelope row driving this message (received_events.id) — non-null para
   * inbound (envelope sempre existe). NULL para outbound (`direction='outgoing'`),
   * que não tem received_events row, mas é gravado direto pelo seam pós-send.
   * Coluna `received_event_id` é nullable em schema (FK ON DELETE set null).
   */
  receivedEventId: string | null;
  conversationKey: string;
  externalMessageId: string;
  direction: "incoming" | "outgoing";
  contentText: string | null;
  messageCreatedAt: string;
  senderSnapshotJson: unknown;
  mediaJson?: unknown;
}

/**
 * Persist message envelope-derived fields to `message_records`.
 *
 * Clone shape from going-away `ingestion/repository.ts insertMessageRecord`
 * (P3 0014 rename applied — uses `external_message_id` SQL identifier).
 * ON CONFLICT (conversation_key, external_message_id) DO NOTHING garante
 * idempotency em Meta retry / duplicate webhook delivery.
 *
 * M5-P3c: `contentText` nullable (media-only) + `media_json` (array de
 * media refs, NULL quando ausente). Cast `::jsonb` espelha sender_snapshot.
 *
 * Outbound POC (Finding HIGH outgoing-messages-not-persisted): chamado pelo
 * seam `deliverToChannel` pós-send sucesso, com `receivedEventId=null` +
 * `direction='outgoing'`. Idempotency garantida pela mesma unique constraint.
 *
 * Marco 4 P4 / Marco 5 P3c.
 */
export async function insertMessageRecord(input: MessageRecordInsert): Promise<void> {
  await getDb().execute(
    sql`INSERT INTO message_records
          (id, received_event_id, conversation_key, external_message_id,
           direction, content_text, message_created_at, sender_snapshot_json,
           media_json)
        VALUES (${uuidv7()}, ${input.receivedEventId}, ${input.conversationKey},
                ${input.externalMessageId}, ${input.direction},
                ${input.contentText}, ${input.messageCreatedAt},
                ${JSON.stringify(input.senderSnapshotJson)}::jsonb,
                ${input.mediaJson === undefined || input.mediaJson === null ? null : JSON.stringify(input.mediaJson)}::jsonb)
        ON CONFLICT (conversation_key, external_message_id) DO NOTHING`,
  );
}
