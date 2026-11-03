/**
 * C2 Google sync engine. Build-to-canon: loop-prevention por extendedProperties.bevox_appointment_id
 * + etag + synced_at±5s (NÃO wall-clock puro); refreshTokenIfNeeded
 * compartilhado; matriz de erro §8.
 */
import { createHmac } from "node:crypto";

import { sql } from "drizzle-orm";

import { env } from "@/config/env.js";
import { getDb } from "@/db/client.js";
import { decryptToken, encryptToken } from "@/lib/token-crypto.js";
import { errors } from "@/shared/errors.js";
import { uuidv7 } from "@/shared/uuid.js";

import {
  createGoogleEvent,
  deleteGoogleEvent,
  type GoogleEvent,
  GoogleApiError,
  listEvents,
  startWatch,
  stopWatch,
  updateGoogleEvent,
} from "./client.js";
import { GOOGLE_OAUTH_TOKEN_URL, GOOGLE_WATCH_TTL_MS } from "./constants.js";
import { withRedisLock } from "./lock.js";
import * as repo from "./repository.js";

const ECHO_TOLERANCE_MS = 5_000;

/**
 * Eco do próprio push? canon §5.5. Pura, total, sem IO — unit-testada.
 *
 * Discriminadores, em ordem:
 *  1. Gate `bevox_appointment_id` (canon §5.5, INALTERADO, sempre primeiro):
 *     se o evento não carrega a tag OU não corresponde ao mapping → não é
 *     nosso evento, não é eco.
 *  2. Sinal PRIMÁRIO — igualdade de etag (EXATO, não heurístico): o webhook
 *     de eco reentrega o MESMO evento com o MESMO `etag` que o Google nos
 *     devolveu no push; qualquer edição externa real muda o etag. Logo
 *     `ev.etag === mapping.google_etag` ⇒ é nosso eco não modificado.
 *     Se ambos os etags estão presentes e DIFEREM ⇒ o Google mudou desde o
 *     push ⇒ NÃO é eco; retorna false SEM consultar a janela de tempo (a
 *     divergência de etag é evidência autoritativa de mudança externa).
 *  3. Fallback — janela `synced_at±5s` (canon §5.5, limitada): usada APENAS
 *     quando a comparação de etag não é decisiva (um/ambos etags ausentes).
 */
export function isOwnEcho(
  ev: {
    extendedProperties?: { private?: Record<string, string> };
    updated?: string;
    etag?: string;
  },
  mapping: { appointment_id: string; synced_at: Date | null; google_etag?: string | null } | null,
): boolean {
  const tag = ev.extendedProperties?.private?.bevox_appointment_id;
  // 1. Gate canon §5.5 — inalterado, sempre primeiro.
  if (!tag || !mapping || mapping.appointment_id !== tag) return false;
  // 2. Sinal primário: igualdade de etag (exato).
  const evEtag = ev.etag ?? null;
  const mapEtag = mapping.google_etag ?? null;
  if (evEtag !== null && mapEtag !== null) {
    return evEtag === mapEtag;
  }
  // 3. Fallback canon §5.5: janela synced_at±5s (etag não decisivo).
  if (!mapping.synced_at || !ev.updated) return false;
  const drift = Math.abs(new Date(ev.updated).getTime() - mapping.synced_at.getTime());
  return drift <= ECHO_TOLERANCE_MS;
}

/**
 * Audit append-only reconciliado ao schema real `audit_events`
 * (espelha `insertApprovalAudit`): `id` tem default DB (OMITIDO),
 * `entity_type`/`organization_id` NOT NULL, `actor_type` enum
 * `'user'|'ai'|'system'|'webhook'`. Google não tem execução → `execution_id`
 * e `actor_id` NULL. NUNCA PII/token em `after_json` — só ids + metadata
 * que o caller passa (callers NÃO devem passar tokens).
 */
export async function insertGoogleAudit(
  action: string,
  orgId: string,
  connectionId: string,
  extra?: Record<string, unknown>,
): Promise<void> {
  await getDb().execute(sql`
    INSERT INTO audit_events
      (organization_id, entity_type, entity_id, action, actor_type, actor_id, reason_text, execution_id, after_json)
    VALUES (${orgId}, 'calendar_provider_connection', ${connectionId}, ${action}, 'system', NULL, NULL, NULL,
            ${JSON.stringify({ connection_id: connectionId, ...(extra ?? {}) })}::jsonb)`);
}

/** Token válido em cache (≥60s de folga)? Pure-ish, sem refresh nem lock. */
function cachedValidToken(conn: repo.GoogleConnection, key: string): string | null {
  const valid =
    conn.google_access_token_encrypted &&
    conn.google_access_token_expires_at &&
    conn.google_access_token_expires_at.getTime() > Date.now() + 60_000;
  return valid ? decryptToken(conn.google_access_token_encrypted!, key) : null;
}

/** Faz a troca refresh→access e persiste. Chamado SOMENTE sob lock. */
async function doRefresh(conn: repo.GoogleConnection, key: string): Promise<string> {
  if (!conn.google_refresh_token_encrypted) {
    await repo.setConnectionStatus(conn.id, "token_expired");
    throw errors.conflict("google connection has no refresh token", { connection_id: conn.id });
  }
  const refresh = decryptToken(conn.google_refresh_token_encrypted, key);
  const e = env();
  if (!e.GOOGLE_CLIENT_ID || !e.GOOGLE_CLIENT_SECRET)
    throw errors.internal("Google OAuth env not configured");
  const res = await fetch(GOOGLE_OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: e.GOOGLE_CLIENT_ID,
      client_secret: e.GOOGLE_CLIENT_SECRET,
      refresh_token: refresh,
      grant_type: "refresh_token",
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    const body = await res.text();
    if (body.includes("invalid_grant")) {
      await repo.setConnectionStatus(conn.id, "revoked");
      await insertGoogleAudit("google.connection.revoked", conn.organization_id, conn.id);
      throw errors.conflict("google refresh token revoked", { connection_id: conn.id });
    }
    await repo.setConnectionStatus(conn.id, "error", `refresh ${res.status}`);
    throw errors.conflict("google token refresh failed", { connection_id: conn.id });
  }
  const j = (await res.json()) as { access_token: string; expires_in: number };
  await repo.updateConnectionTokens(
    conn.id,
    encryptToken(j.access_token, key),
    new Date(Date.now() + j.expires_in * 1000),
  );
  return j.access_token;
}

/**
 * Refresh ad-hoc se access-token expira em ≤60s. Compartilhado por TODOS os
 * callers (push/incremental/watch). Single-flight (#1): a seção crítica
 * "needs refresh → POST → updateConnectionTokens" roda sob lock Redis
 * `google:refresh:lock:${conn.id}` (NX EX 30) — só UMA execução faz o POST
 * por conexão. Se o lock NÃO é adquirido (outro caller refrescando agora):
 * espera ~750ms, RE-LÊ a conexão (token provavelmente já refrescado) e usa
 * o cache; retry único — se ainda não há token válido cai no path locked
 * normal. O fast-path de cache-válido é SEM lock (sem custo na rota quente).
 */
export async function refreshTokenIfNeeded(conn: repo.GoogleConnection): Promise<string> {
  const key = env().GOOGLE_TOKEN_ENC_KEY;
  if (!key) throw errors.internal("GOOGLE_TOKEN_ENC_KEY not configured");

  const fast = cachedValidToken(conn, key);
  if (fast) return fast;

  const locked = await withRedisLock(`google:refresh:lock:${conn.id}`, 30, () =>
    doRefresh(conn, key),
  );
  if (locked !== null) return locked;

  // Lock não adquirido — outro caller está refrescando esta conexão.
  // Aguarda brevemente, re-lê e usa o token agora-provavelmente-fresco.
  await new Promise((r) => setTimeout(r, 750));
  const fresh = await repo.findConnectionById(conn.id);
  if (fresh) {
    const reread = cachedValidToken(fresh, key);
    if (reread) return reread;
  }
  // Ainda sem token válido — tenta o path locked uma vez (o lock anterior
  // já liberou ou expirou); se ainda contém, faz o refresh SEM o lock como
  // último recurso. Tradeoff DELIBERADO disponibilidade-sobre-single-flight-
  // estrito: uma dupla-refresh rara é benigna — todo caller usa o
  // access-token retornado IMEDIATAMENTE numa única chamada Google e o
  // descarta; o Google rotaciona só o access-token e mantém o refresh-token
  // válido, então nenhum caller falha por causa do refresh concorrente.
  const retry = await withRedisLock(`google:refresh:lock:${conn.id}`, 30, () =>
    doRefresh(fresh ?? conn, key),
  );
  return retry !== null ? retry : doRefresh(fresh ?? conn, key);
}

interface ApptForSync {
  id: string;
  organization_id: string;
  calendar_id: string;
  service_name: string | null;
  customer_label: string;
  start_at: Date;
  end_at: Date;
  timezone: string;
  status: string;
}

async function loadApptForSync(appointmentId: string): Promise<ApptForSync | null> {
  const r = await getDb().execute(sql`
    SELECT a.id, a.organization_id, a.calendar_id, a.status,
           a.start_at, a.end_at, cal.timezone,
           s.name AS service_name,
           COALESCE(cu.full_name, a.customer_name, 'Cliente') AS customer_label
    FROM appointments a
    JOIN calendars cal ON cal.id = a.calendar_id
    LEFT JOIN services s ON s.id = a.service_id
    LEFT JOIN customers cu ON cu.id = a.customer_id
    WHERE a.id = ${appointmentId} LIMIT 1`);
  return (r.rows[0] as ApptForSync | undefined) ?? null;
}

/** Processa UM intent do outbox. Erros → throw (worker decide requeue/finish). */
export async function processOutboxIntent(intent: {
  id: string;
  organization_id: string;
  appointment_id: string;
  op: string;
}): Promise<"done" | "skipped"> {
  const conn = await repo.findActiveTwoWayForAppointment(
    intent.organization_id,
    intent.appointment_id,
  );
  if (!conn) return "skipped";
  const token = await refreshTokenIfNeeded(conn);
  const appt = await loadApptForSync(intent.appointment_id);
  const mapping = await repo.findMappingByAppointment(intent.appointment_id, conn.id);

  if (intent.op === "delete") {
    if (mapping) {
      await deleteGoogleEvent(token, conn.external_calendar_id, mapping.google_event_id);
      await repo.deleteMapping(intent.appointment_id, conn.id);
    }
    return "done";
  }
  if (!appt) return "skipped";
  const ev = {
    summary: `${appt.service_name ?? "Serviço"} — ${appt.customer_label}`,
    startIso: appt.start_at.toISOString(),
    endIso: appt.end_at.toISOString(),
    timeZone: appt.timezone,
    bevoxAppointmentId: appt.id,
    bevoxOrganizationId: appt.organization_id,
  };
  if (intent.op === "create" && !mapping) {
    const r = await createGoogleEvent(token, conn.external_calendar_id, ev);
    await repo.upsertMapping({
      organizationId: appt.organization_id,
      appointmentId: appt.id,
      connectionId: conn.id,
      googleEventId: r.id,
      etag: r.etag,
      direction: "push",
    });
    return "done";
  }
  if (mapping) {
    try {
      const r = await updateGoogleEvent(
        token,
        conn.external_calendar_id,
        mapping.google_event_id,
        mapping.google_etag,
        ev,
      );
      await repo.upsertMapping({
        organizationId: appt.organization_id,
        appointmentId: appt.id,
        connectionId: conn.id,
        googleEventId: mapping.google_event_id,
        etag: r.etag,
        direction: "push",
      });
    } catch (err) {
      if (err instanceof GoogleApiError && err.status === 412) {
        const r2 = await updateGoogleEvent(
          token,
          conn.external_calendar_id,
          mapping.google_event_id,
          null,
          ev,
        );
        await repo.upsertMapping({
          organizationId: appt.organization_id,
          appointmentId: appt.id,
          connectionId: conn.id,
          googleEventId: mapping.google_event_id,
          etag: r2.etag,
          direction: "push",
        });
        await insertGoogleAudit("google.sync.conflict", appt.organization_id, conn.id, {
          appointment_id: appt.id,
        });
      } else if (err instanceof GoogleApiError && err.status === 404) {
        await repo.deleteMapping(intent.appointment_id, conn.id);
      } else throw err;
    }
    return "done";
  }
  return "skipped";
}

/* ────────────────────────── C2 T7 — PART 2 ──────────────────────────
 * Pull/incremental (410→full-resync), applyExternalEvent (loop-prevention
 * via isOwnEcho + source='external_sync'), watch lifecycle (arm/renew
 * stop-old→start), initial-sync. Não altera PART 1 (T6).
 */

function firstActiveServiceSql(calendarId: string) {
  return sql`(SELECT id FROM services WHERE organization_id = (SELECT organization_id FROM calendars WHERE id = ${calendarId}) AND is_active = true ORDER BY id LIMIT 1)`;
}
function firstBookableProfSql(calendarId: string) {
  return sql`(SELECT id FROM professionals WHERE organization_id = (SELECT organization_id FROM calendars WHERE id = ${calendarId}) AND is_bookable = true AND is_active = true ORDER BY id LIMIT 1)`;
}

/**
 * Detecta NOT-NULL violation (pg SQLSTATE 23502). pg/node-postgres lança
 * `DatabaseError` com `.code` string; drizzle node-postgres o propaga sem
 * reescrever. Guard estrutural — mesmo padrão de
 * booking.ts:isIdempotencyUniqueViolation (23505). Aqui: o INSERT de
 * external-new-event ancora em `firstActiveServiceSql`/`firstBookableProfSql`;
 * se a org não tem serviço ativo OU profissional bookable, a subquery rende
 * NULL e o INSERT viola `service_id`/`professional_id` NOT NULL (C1 schema)
 * → THROW 23502 (NÃO retorna 0 linhas). Skip honesto: o backend impõe
 * FK NOT NULL → não criamos órfão.
 */
function isNotNullViolation(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  return (err as { code?: unknown }).code === "23502";
}

/** Incremental pull de UMA conexão. 410 → full-resync (limpa syncToken). */
export async function runIncrementalSync(connectionId: string): Promise<void> {
  const conn = await repo.findConnectionById(connectionId);
  if (!conn || conn.status === "revoked") return;
  const token = await refreshTokenIfNeeded(conn);
  let res;
  try {
    res = await listEvents(
      token,
      conn.external_calendar_id,
      conn.google_sync_token
        ? { syncToken: conn.google_sync_token }
        : { timeMinIso: new Date().toISOString() },
    );
  } catch (err) {
    if (err instanceof GoogleApiError && err.status === 410) {
      await repo.setSyncToken(conn.id, null);
      res = await listEvents(token, conn.external_calendar_id, {
        timeMinIso: new Date().toISOString(),
      });
    } else throw err;
  }
  for (const ev of res.events) {
    await applyExternalEvent(conn, ev);
  }
  await repo.setSyncToken(conn.id, res.nextSyncToken);
}

async function applyExternalEvent(conn: repo.GoogleConnection, ev: GoogleEvent): Promise<void> {
  const mapping = await repo.findMappingByEvent(conn.id, ev.id);
  const mapForEcho = mapping
    ? {
        appointment_id: mapping.appointment_id,
        synced_at: mapping.synced_at,
        google_etag: mapping.google_etag,
      }
    : null;
  if (isOwnEcho(ev, mapForEcho)) return;

  if (ev.status === "cancelled") {
    if (mapping) {
      await getDb().execute(
        sql`UPDATE appointments SET status = 'cancelled', cancelled_at = now(), cancellation_reason = 'google_external_cancel', updated_at = now() WHERE id = ${mapping.appointment_id} AND organization_id = ${conn.organization_id}`,
      );
      await repo.deleteMapping(mapping.appointment_id, conn.id);
    }
    return;
  }
  const startIso = ev.start?.dateTime ?? (ev.start?.date ? `${ev.start.date}T00:00:00Z` : null);
  const endIso = ev.end?.dateTime ?? (ev.end?.date ? `${ev.end.date}T00:00:00Z` : null);
  if (!startIso || !endIso) return;

  if (mapping) {
    await getDb().execute(
      sql`UPDATE appointments SET start_at = ${startIso}::timestamptz, end_at = ${endIso}::timestamptz, updated_at = now() WHERE id = ${mapping.appointment_id} AND organization_id = ${conn.organization_id}`,
    );
    await repo.upsertMapping({
      organizationId: conn.organization_id,
      appointmentId: mapping.appointment_id,
      connectionId: conn.id,
      googleEventId: ev.id,
      etag: ev.etag,
      direction: "pull",
    });
    return;
  }
  const apptId = uuidv7();
  // service_id/professional_id são NOT NULL (C1). As subqueries
  // firstActiveServiceSql/firstBookableProfSql rendem NULL se a org não tem
  // serviço ativo / profissional bookable → INSERT viola NOT NULL e LANÇA
  // 23502 (o guard ins.rows.length===0 é morto para esse caso). Skip honesto:
  // não criar órfão; preserva status, marca last_sync_status. Reconciliação
  // consciente: o backend impõe FK NOT NULL.
  let ins;
  try {
    ins = await getDb().execute(sql`
    INSERT INTO appointments
      (id, organization_id, calendar_id, service_id, professional_id,
       customer_name, start_at, end_at, status, source)
    VALUES (${apptId}, ${conn.organization_id}, ${conn.calendar_id},
            ${firstActiveServiceSql(conn.calendar_id)}, ${firstBookableProfSql(conn.calendar_id)},
            ${ev.summary ?? "Google event"}, ${startIso}::timestamptz, ${endIso}::timestamptz,
            'scheduled', 'external_sync')
    RETURNING id`);
  } catch (err) {
    if (isNotNullViolation(err)) {
      await repo.setConnectionStatus(conn.id, conn.status, "skipped_no_service");
      return;
    }
    throw err;
  }
  if (ins.rows.length === 0) return;
  await repo.upsertMapping({
    organizationId: conn.organization_id,
    appointmentId: apptId,
    connectionId: conn.id,
    googleEventId: ev.id,
    etag: ev.etag,
    direction: "pull",
  });
}

function watchToken(channelId: string): string {
  const secret = env().GOOGLE_WEBHOOK_SECRET;
  if (!secret) throw errors.internal("GOOGLE_WEBHOOK_SECRET not configured");
  return createHmac("sha256", secret).update(channelId).digest("hex");
}

/** Arma um watch novo (pós-OAuth e na renovação). */
export async function armWatch(connectionId: string): Promise<void> {
  const conn = await repo.findConnectionById(connectionId);
  if (!conn || conn.status === "revoked") return;
  const token = await refreshTokenIfNeeded(conn);
  const channelId = uuidv7();
  const e = env();
  // Google Watch exige URL HTTPS pública/roteável + domínio verificado.
  // PUBLIC_API_BASE_URL é a base pública canônica (#4); fallback p/
  // HARNESS_CALLBACK_BASE_URL preserva o comportamento de dev.
  const base = e.PUBLIC_API_BASE_URL ?? e.HARNESS_CALLBACK_BASE_URL;
  const address = `${base}/api/v1/webhooks/google`;
  const expirationMs = Date.now() + GOOGLE_WATCH_TTL_MS;
  const w = await startWatch(
    token,
    conn.external_calendar_id,
    channelId,
    address,
    watchToken(channelId),
    expirationMs,
  );
  await repo.setWatch(conn.id, channelId, w.resourceId, new Date(w.expiration));
}

/** Renovação: stop-old-then-start-new (sem omitir o stop do canal antigo). */
export async function renewWatch(connectionId: string): Promise<void> {
  const conn = await repo.findConnectionById(connectionId);
  if (!conn || conn.status === "revoked") return;
  const token = await refreshTokenIfNeeded(conn);
  if (conn.google_watch_channel_id && conn.google_watch_resource_id) {
    await stopWatch(token, conn.google_watch_channel_id, conn.google_watch_resource_id);
  }
  await armWatch(connectionId);
}

/** Initial pull pós-OAuth (timeMin=now, sem syncToken). */
export async function runInitialSync(connectionId: string): Promise<void> {
  await runIncrementalSync(connectionId);
}
