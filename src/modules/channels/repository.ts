/**
 * Repository — channels module. getDb() parameterized SQL (repo
 * convention; no static @db import). Queries + upsert ops consumed by the
 * B1 seam (findChannelConnection) and by B2 (§8.1.3 upserts).
 */

import { sql } from "drizzle-orm";

import { cacheAside, cacheInvalidate } from "@/lib/cache.js";
import { getDb } from "@/db/client.js";
import { uuidv7 } from "@/shared/uuid.js";

const CHCONN_CACHE_NAMESPACE = "channel-connection";
const CHCONN_CACHE_TTL_SECONDS = 30;

export interface ChannelConnectionRow {
  id: string;
  organization_id: string;
  provider: string;
  external_account_id: string;
  status: string;
  routing_config_json: unknown;
}

export async function findChannelConnection(
  provider: string,
  externalAccountId: string,
): Promise<ChannelConnectionRow | null> {
  const res = await getDb().execute(
    sql`SELECT id, organization_id, provider, external_account_id, status,
               routing_config_json
        FROM channel_connections
        WHERE provider = ${provider} AND external_account_id = ${externalAccountId}
        LIMIT 1`,
  );
  return (res.rows[0] as ChannelConnectionRow | undefined) ?? null;
}

export async function findChannelConnectionById(id: string): Promise<ChannelConnectionRow | null> {
  return (await cacheAside(id, {
    namespace: CHCONN_CACHE_NAMESPACE,
    ttlSeconds: CHCONN_CACHE_TTL_SECONDS,
    fetch: async () => {
      const res = await getDb().execute(
        sql`SELECT id, organization_id, provider, external_account_id, status,
                   routing_config_json
            FROM channel_connections
            WHERE id = ${id}
            LIMIT 1`,
      );
      return (res.rows[0] as ChannelConnectionRow | undefined) ?? null;
    },
  })) as ChannelConnectionRow | null;
}

export async function upsertChannelConnection(input: {
  organizationId: string;
  provider: string;
  externalAccountId: string;
  displayName?: string | null;
  status?: string;
  routingConfigJson?: unknown;
}): Promise<string> {
  const id = uuidv7();
  const res = await getDb().execute(
    sql`INSERT INTO channel_connections
          (id, organization_id, provider, external_account_id, display_name,
           status, routing_config_json)
        VALUES (${id}, ${input.organizationId}, ${input.provider},
                ${input.externalAccountId}, ${input.displayName ?? null},
                ${input.status ?? "pending"},
                ${JSON.stringify(input.routingConfigJson ?? {})}::jsonb)
        ON CONFLICT (organization_id, provider, external_account_id)
        DO UPDATE SET status = EXCLUDED.status,
                      display_name = COALESCE(EXCLUDED.display_name, channel_connections.display_name),
                      routing_config_json = EXCLUDED.routing_config_json,
                      updated_at = now()
        RETURNING id`,
  );
  const returnedId = (res.rows[0] as { id: string }).id;
  await cacheInvalidate(CHCONN_CACHE_NAMESPACE, returnedId);
  return returnedId;
}

/**
 * SEV-M-07 (V1): exact `external_user_id` match within (org, provider);
 * if absent, creates the Customer then the CustomerChannel in TWO
 * non-transactional inserts (no tx helper exists in the codebase yet).
 * B2 MUST wrap this in a transaction when wiring §8.1.3 inbound — there is
 * a partial-failure window (orphan Customer if the CustomerChannel insert
 * fails) until then. Phone-OTP match is a follow-on. C provides; B2
 * orchestrates.
 */
export async function resolveOrCreateCustomerChannel(input: {
  organizationId: string;
  provider: string;
  externalUserId: string;
  displayName?: string | null;
  phoneNumber?: string | null;
}): Promise<{ customerId: string; customerChannelId: string }> {
  const db = getDb();
  const existing = await db.execute(
    sql`SELECT id, customer_id FROM customer_channels
        WHERE organization_id = ${input.organizationId}
          AND provider = ${input.provider}
          AND external_user_id = ${input.externalUserId}
        LIMIT 1`,
  );
  const hit = existing.rows[0] as { id: string; customer_id: string } | undefined;
  if (hit) return { customerId: hit.customer_id, customerChannelId: hit.id };

  const customerId = uuidv7();
  await db.execute(
    sql`INSERT INTO customers (id, organization_id, full_name)
        VALUES (${customerId}, ${input.organizationId},
                ${input.displayName ?? "Cliente"})`,
  );
  const customerChannelId = uuidv7();
  const inserted = await db.execute(
    sql`INSERT INTO customer_channels
          (id, organization_id, customer_id, provider, external_user_id,
           display_name, phone_number, is_primary)
        VALUES (${customerChannelId}, ${input.organizationId}, ${customerId},
                ${input.provider}, ${input.externalUserId},
                ${input.displayName ?? null}, ${input.phoneNumber ?? null}, true)
        ON CONFLICT (organization_id, provider, external_user_id)
        DO NOTHING
        RETURNING id`,
  );
  const insertedRow = inserted.rows[0] as { id: string } | undefined;
  if (insertedRow) return { customerId, customerChannelId };

  // Concurrent insert won the race (UNIQUE on org/provider/external_user_id).
  // Re-select the winner's row so the caller gets the winner's customer, not
  // the orphan Customer just inserted above (orphan = the documented
  // partial-failure window the docstring describes; B2's tx removes it).
  const winner = await db.execute(
    sql`SELECT id, customer_id FROM customer_channels
        WHERE organization_id = ${input.organizationId}
          AND provider = ${input.provider}
          AND external_user_id = ${input.externalUserId}
        LIMIT 1`,
  );
  const winnerRow = winner.rows[0] as { id: string; customer_id: string };
  return { customerId: winnerRow.customer_id, customerChannelId: winnerRow.id };
}

export async function listChannelConnections(orgId: string): Promise<ChannelConnectionRow[]> {
  const res = await getDb().execute(
    sql`SELECT id, organization_id, provider, external_account_id, status,
               routing_config_json
        FROM channel_connections WHERE organization_id = ${orgId}
        ORDER BY created_at DESC`,
  );
  return res.rows as unknown as ChannelConnectionRow[];
}
