/** C2 Google repo. SQL parametrizado getDb()/tx; sem import @/db/schema. */
import { sql } from "drizzle-orm";

import { getDb } from "@/db/client.js";
import { uuidv7 } from "@/shared/uuid.js";

export interface GoogleConnection {
  id: string;
  organization_id: string;
  calendar_id: string;
  professional_id: string | null;
  sync_mode: string;
  status: string;
  google_account_email: string | null;
  external_calendar_id: string;
  google_refresh_token_encrypted: Buffer | null;
  google_access_token_encrypted: Buffer | null;
  google_access_token_expires_at: Date | null;
  google_watch_channel_id: string | null;
  google_watch_resource_id: string | null;
  google_watch_expires_at: Date | null;
  google_sync_token: string | null;
}

export async function findConnectionById(id: string): Promise<GoogleConnection | null> {
  const r = await getDb().execute(
    sql`SELECT * FROM calendar_provider_connections WHERE id = ${id} LIMIT 1`,
  );
  return (r.rows[0] as GoogleConnection | undefined) ?? null;
}

export async function findConnectionByWatchChannel(
  channelId: string,
): Promise<GoogleConnection | null> {
  const r = await getDb().execute(
    sql`SELECT * FROM calendar_provider_connections WHERE google_watch_channel_id = ${channelId} LIMIT 1`,
  );
  return (r.rows[0] as GoogleConnection | undefined) ?? null;
}

export async function findActiveTwoWayForAppointment(
  orgId: string,
  appointmentId: string,
): Promise<GoogleConnection | null> {
  const r = await getDb().execute(sql`
    SELECT c.* FROM calendar_provider_connections c
    JOIN appointments a ON a.calendar_id = c.calendar_id AND a.organization_id = c.organization_id
    WHERE a.id = ${appointmentId} AND c.organization_id = ${orgId}
      AND c.provider = 'google' AND c.status = 'connected' AND c.sync_mode = 'two_way'
      AND (c.professional_id = a.professional_id OR c.professional_id IS NULL)
    ORDER BY (c.professional_id IS NOT NULL) DESC, c.created_at ASC LIMIT 1`);
  return (r.rows[0] as GoogleConnection | undefined) ?? null;
}

export async function listConnections(orgId: string, calendarId: string) {
  const r = await getDb().execute(sql`
    SELECT id, calendar_id, professional_id, google_account_email, sync_mode, status,
           external_calendar_id, last_sync_at, last_sync_status, created_at
    FROM calendar_provider_connections
    WHERE organization_id = ${orgId} AND calendar_id = ${calendarId}
    ORDER BY created_at DESC LIMIT 200`);
  return r.rows;
}

export async function listActiveConnections(): Promise<GoogleConnection[]> {
  const r = await getDb().execute(
    sql`SELECT * FROM calendar_provider_connections WHERE provider = 'google' AND status = 'connected'`,
  );
  return r.rows as unknown as GoogleConnection[];
}

export async function upsertConnection(input: {
  organizationId: string;
  calendarId: string;
  professionalId: string | null;
  googleAccountEmail: string;
  externalCalendarId: string;
  refreshTokenEncrypted: Buffer | null;
  accessTokenEncrypted: Buffer;
  accessTokenExpiresAt: Date;
}): Promise<string> {
  const id = uuidv7();
  // Dois índices únicos parciais distintos — ON CONFLICT precisa inferir o
  // índice correto pelo predicado (Postgres: ON CONFLICT (cols) WHERE pred).
  const conflictClause = input.professionalId
    ? sql`(calendar_id, professional_id, provider) WHERE professional_id IS NOT NULL`
    : sql`(calendar_id, provider) WHERE professional_id IS NULL`;
  const r = await getDb().execute(sql`
    INSERT INTO calendar_provider_connections
      (id, organization_id, calendar_id, professional_id, provider, status,
       google_account_email, external_calendar_id, google_refresh_token_encrypted,
       google_access_token_encrypted, google_access_token_expires_at)
    VALUES (${id}, ${input.organizationId}, ${input.calendarId}, ${input.professionalId},
            'google', 'connected', ${input.googleAccountEmail}, ${input.externalCalendarId},
            ${input.refreshTokenEncrypted}, ${input.accessTokenEncrypted}, ${input.accessTokenExpiresAt})
    ON CONFLICT ${conflictClause} DO UPDATE SET
      status = 'connected', google_account_email = EXCLUDED.google_account_email,
      external_calendar_id = EXCLUDED.external_calendar_id,
      google_refresh_token_encrypted = COALESCE(EXCLUDED.google_refresh_token_encrypted, calendar_provider_connections.google_refresh_token_encrypted),
      google_access_token_encrypted = EXCLUDED.google_access_token_encrypted,
      google_access_token_expires_at = EXCLUDED.google_access_token_expires_at,
      updated_at = now()
    RETURNING id`);
  return (r.rows[0] as { id: string }).id;
}

export async function updateConnectionTokens(
  id: string,
  accessTokenEncrypted: Buffer,
  expiresAt: Date,
): Promise<void> {
  await getDb().execute(
    sql`UPDATE calendar_provider_connections SET google_access_token_encrypted = ${accessTokenEncrypted}, google_access_token_expires_at = ${expiresAt}, status = 'connected', updated_at = now() WHERE id = ${id}`,
  );
}

export async function setConnectionStatus(
  id: string,
  status: string,
  lastSyncStatus?: string,
): Promise<void> {
  await getDb().execute(
    sql`UPDATE calendar_provider_connections SET status = ${status}, last_sync_status = COALESCE(${lastSyncStatus ?? null}, last_sync_status), updated_at = now() WHERE id = ${id}`,
  );
}

export async function setWatch(
  id: string,
  channelId: string,
  resourceId: string,
  expiresAt: Date,
): Promise<void> {
  await getDb().execute(
    sql`UPDATE calendar_provider_connections SET google_watch_channel_id = ${channelId}, google_watch_resource_id = ${resourceId}, google_watch_expires_at = ${expiresAt}, updated_at = now() WHERE id = ${id}`,
  );
}

export async function clearWatchAndTokens(id: string): Promise<void> {
  await getDb().execute(
    sql`UPDATE calendar_provider_connections SET status = 'revoked', google_refresh_token_encrypted = NULL, google_access_token_encrypted = NULL, google_watch_channel_id = NULL, google_watch_resource_id = NULL, google_watch_expires_at = NULL, google_sync_token = NULL, updated_at = now() WHERE id = ${id}`,
  );
}

export async function setSyncToken(id: string, token: string | null): Promise<void> {
  await getDb().execute(
    sql`UPDATE calendar_provider_connections SET google_sync_token = ${token}, last_sync_at = now(), last_sync_status = 'ok', updated_at = now() WHERE id = ${id}`,
  );
}

export async function connectionsNeedingWatchRenewal(): Promise<GoogleConnection[]> {
  const r = await getDb().execute(sql`
    SELECT * FROM calendar_provider_connections
    WHERE provider = 'google' AND status IN ('connected','token_expired')
      AND google_watch_expires_at IS NOT NULL
      AND google_watch_expires_at < now() + interval '2 days'`);
  return r.rows as unknown as GoogleConnection[];
}

export async function findMappingByAppointment(appointmentId: string, connectionId: string) {
  const r = await getDb().execute(
    sql`SELECT * FROM appointment_google_events WHERE appointment_id = ${appointmentId} AND google_connection_id = ${connectionId} LIMIT 1`,
  );
  return (
    (r.rows[0] as
      | {
          id: string;
          google_event_id: string;
          google_etag: string | null;
          synced_at: Date | null;
          appointment_id: string;
        }
      | undefined) ?? null
  );
}

export async function findMappingByEvent(connectionId: string, googleEventId: string) {
  const r = await getDb().execute(
    sql`SELECT * FROM appointment_google_events WHERE google_connection_id = ${connectionId} AND google_event_id = ${googleEventId} LIMIT 1`,
  );
  return (
    (r.rows[0] as
      | { id: string; appointment_id: string; google_etag: string | null; synced_at: Date | null }
      | undefined) ?? null
  );
}

export async function upsertMapping(input: {
  organizationId: string;
  appointmentId: string;
  connectionId: string;
  googleEventId: string;
  etag: string | null;
  direction: "push" | "pull";
}): Promise<void> {
  await getDb().execute(sql`
    INSERT INTO appointment_google_events
      (id, organization_id, appointment_id, google_connection_id, google_event_id, google_etag, last_direction, synced_at)
    VALUES (${uuidv7()}, ${input.organizationId}, ${input.appointmentId}, ${input.connectionId}, ${input.googleEventId}, ${input.etag}, ${input.direction}, now())
    ON CONFLICT (appointment_id, google_connection_id) DO UPDATE SET
      google_event_id = EXCLUDED.google_event_id, google_etag = EXCLUDED.google_etag,
      last_direction = EXCLUDED.last_direction, synced_at = now(), updated_at = now()`);
}

export async function deleteMapping(appointmentId: string, connectionId: string): Promise<void> {
  await getDb().execute(
    sql`DELETE FROM appointment_google_events WHERE appointment_id = ${appointmentId} AND google_connection_id = ${connectionId}`,
  );
}

export async function insertWebhookEvent(input: {
  connectionId: string;
  channelId: string;
  resourceId: string;
  resourceState: string;
  messageNumber: string;
}): Promise<void> {
  await getDb().execute(sql`
    INSERT INTO google_calendar_webhook_events
      (id, google_connection_id, channel_id, resource_id, resource_state, message_number, processing_status)
    VALUES (${uuidv7()}, ${input.connectionId}, ${input.channelId}, ${input.resourceId}, ${input.resourceState}, ${input.messageNumber}, 'pending')`);
}

export interface OutboxRow {
  id: string;
  organization_id: string;
  appointment_id: string;
  op: string;
  attempts: number;
}

/**
 * Claim é race-free: FOR UPDATE SKIP LOCKED no subselect — workers concorrentes
 * pegam conjuntos disjuntos. A SELEÇÃO é FIFO (ORDER BY created_at ASC, mais
 * antigos primeiro), MAS o array retornado por RETURNING NÃO tem ordem garantida
 * (Postgres não propaga o ORDER BY do subselect para o RETURNING do UPDATE).
 * O worker que consome NÃO deve assumir ordem do array — reordenar se precisar
 * de FIFO estrito no processamento.
 */
export async function claimOutboxBatch(limit: number): Promise<OutboxRow[]> {
  const r = await getDb().execute(sql`
    UPDATE google_sync_outbox SET status = 'processing'
    WHERE id IN (
      SELECT id FROM google_sync_outbox WHERE status = 'pending'
      ORDER BY created_at ASC LIMIT ${limit} FOR UPDATE SKIP LOCKED)
    RETURNING id, organization_id, appointment_id, op, attempts`);
  return r.rows as unknown as OutboxRow[];
}

export async function finishOutbox(
  id: string,
  status: "done" | "error" | "skipped",
  lastError?: string,
): Promise<void> {
  await getDb().execute(
    sql`UPDATE google_sync_outbox SET status = ${status}, attempts = attempts + 1, last_error = ${lastError ?? null}, processed_at = now() WHERE id = ${id}`,
  );
}

export async function requeueOutbox(id: string, lastError: string): Promise<void> {
  await getDb().execute(
    sql`UPDATE google_sync_outbox SET status = 'pending', attempts = attempts + 1, last_error = ${lastError} WHERE id = ${id}`,
  );
}
