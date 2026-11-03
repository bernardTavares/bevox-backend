/**
 * Waitlist — todo acesso a DB. SQL parametrizado (sem import estático de
 * @/db/schema). CAS-claim espelha claimPipelineForCutoff
 * (orchestration/repository.ts): UPDATE guardado + RETURNING vazio = corrida
 * perdida. Outbox claim espelha claimOutboxBatch (google/repository.ts):
 * FOR UPDATE SKIP LOCKED. Auditoria: entity_type='waitlist_entry'
 * (NÃO 'execution' — não é uma execução; execution_id NULL).
 */
import { sql } from "drizzle-orm";

import { getDb } from "@/db/client.js";
import { uuidv7 } from "@/shared/uuid.js";

import type { WaitlistCandidate } from "./match.js";

/**
 * Handle estrutural de tx (db.transaction passa um objeto com .execute).
 * Definido localmente p/ não acoplar a um tipo possivelmente não-exportado
 * de @/db/client.js — o `tx` de db.transaction satisfaz isto estruturalmente.
 */
type SqlExec = {
  // node-postgres/drizzle `tx.execute` resolve a QueryResult cujo
  // `rowCount` é `number | null` — aceitar null aqui mantém o handle
  // estruturalmente compatível com o `tx` real (consumo via `?? 0`).
  execute: (q: ReturnType<typeof sql>) => Promise<{ rows: unknown[]; rowCount?: number | null }>;
};

/** Gate puro de enfileiramento: slot precisa ser >= agora. */
export function slotIsFuture(slotStartAt: Date, now: Date = new Date()): boolean {
  return slotStartAt.getTime() >= now.getTime();
}

export interface WaitlistOutboxRow {
  id: string;
  organization_id: string;
  calendar_id: string;
  slot_start_at: string;
  service_id: string | null;
  professional_id: string | null;
  attempts: number;
}

export async function enqueueMatchIntentTx(
  tx: SqlExec,
  input: {
    organizationId: string;
    calendarId: string;
    slotStartAt: Date;
    serviceId: string | null;
    professionalId: string | null;
  },
  now: Date = new Date(),
): Promise<void> {
  if (!slotIsFuture(input.slotStartAt, now)) return;
  await tx.execute(sql`
    INSERT INTO waitlist_match_outbox
      (id, organization_id, calendar_id, slot_start_at, service_id, professional_id, status)
    VALUES (${uuidv7()}, ${input.organizationId}, ${input.calendarId},
            ${input.slotStartAt.toISOString()}, ${input.serviceId},
            ${input.professionalId}, 'pending')`);
}

/**
 * Claim FOR UPDATE SKIP LOCKED (espelha claimOutboxBatch). A SELEÇÃO é
 * FIFO (ORDER BY created_at ASC), MAS o array de RETURNING NÃO tem ordem
 * garantida (Postgres não propaga o ORDER BY do subselect ao RETURNING do
 * UPDATE). O consumidor (Task 7/8) NÃO deve assumir ordem FIFO do array.
 */
export async function claimMatchBatch(limit: number): Promise<WaitlistOutboxRow[]> {
  const r = await getDb().execute(sql`
    UPDATE waitlist_match_outbox SET status = 'processing', updated_at = now()
    WHERE id IN (
      SELECT id FROM waitlist_match_outbox WHERE status = 'pending'
      ORDER BY created_at ASC LIMIT ${limit} FOR UPDATE SKIP LOCKED)
    RETURNING id, organization_id, calendar_id, slot_start_at, service_id, professional_id, attempts`);
  return r.rows as unknown as WaitlistOutboxRow[];
}

export async function finishMatch(
  id: string,
  status: "done" | "dead",
  lastError?: string,
): Promise<void> {
  await getDb().execute(sql`
    UPDATE waitlist_match_outbox
    SET status = ${status}, attempts = attempts + 1,
        last_error = ${lastError ?? null}, processed_at = now(), updated_at = now()
    WHERE id = ${id}`);
}

export async function requeueMatch(id: string, lastError: string): Promise<void> {
  await getDb().execute(sql`
    UPDATE waitlist_match_outbox
    SET status = 'pending', attempts = attempts + 1, last_error = ${lastError}, updated_at = now()
    WHERE id = ${id}`);
}

/**
 * Re-enfileira pending órfãos (processing parado). Retorna a contagem via
 * `rowCount` do driver node-postgres (sempre numérico em DML) — não via
 * RETURNING; difere do house-style `.rows.length`, escolha deliberada p/
 * um sweep só-contagem.
 */
export async function requeueStuckProcessing(olderThanMinutes: number): Promise<number> {
  const r = await getDb().execute(sql`
    UPDATE waitlist_match_outbox SET status = 'pending', updated_at = now()
    WHERE status = 'processing'
      AND updated_at < now() - (${olderThanMinutes} || ' minutes')::interval`);
  return r.rowCount ?? 0;
}

export async function loadWaitingCandidates(calendarId: string): Promise<WaitlistCandidate[]> {
  const r = await getDb().execute(sql`
    SELECT id, service_id, professional_id, preferred_date_from, preferred_date_to,
           preferred_time_from, preferred_time_to, priority_score, priority,
           position, created_at
    FROM waitlist_entries
    WHERE calendar_id = ${calendarId} AND status = 'waiting'`);
  return (r.rows as Array<Record<string, unknown>>).map((row) => ({
    id: row.id as string,
    service_id: (row.service_id as string | null) ?? null,
    professional_id: (row.professional_id as string | null) ?? null,
    preferred_date_from: (row.preferred_date_from as string | null) ?? null,
    preferred_date_to: (row.preferred_date_to as string | null) ?? null,
    preferred_time_from: (row.preferred_time_from as string | null) ?? null,
    preferred_time_to: (row.preferred_time_to as string | null) ?? null,
    priority_score: String(row.priority_score ?? "0"),
    priority: Number(row.priority ?? 0),
    position: row.position === null || row.position === undefined ? null : Number(row.position),
    created_at: new Date(row.created_at as string),
  }));
}

export async function getEntryForBooking(entryId: string): Promise<{
  organization_id: string;
  calendar_id: string;
  service_id: string | null;
  professional_id: string | null;
  customer_id: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  customer_email: string | null;
} | null> {
  const r = await getDb().execute(sql`
    SELECT organization_id, calendar_id, service_id, professional_id,
           customer_id, customer_name, customer_phone, customer_email
    FROM waitlist_entries WHERE id = ${entryId} LIMIT 1`);
  const row = r.rows[0] as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    organization_id: row.organization_id as string,
    calendar_id: row.calendar_id as string,
    service_id: (row.service_id as string | null) ?? null,
    professional_id: (row.professional_id as string | null) ?? null,
    customer_id: (row.customer_id as string | null) ?? null,
    customer_name: (row.customer_name as string | null) ?? null,
    customer_phone: (row.customer_phone as string | null) ?? null,
    customer_email: (row.customer_email as string | null) ?? null,
  };
}

export async function casClaimEntry(
  entryId: string,
  newStatus: "accepted" | "offered",
  fields: { offeredAt?: Date | null; offerExpiresAt?: Date | null },
): Promise<boolean> {
  const r = await getDb().execute(sql`
    UPDATE waitlist_entries
    SET status = ${newStatus},
        offered_at = ${fields.offeredAt ? fields.offeredAt.toISOString() : null},
        offer_expires_at = ${fields.offerExpiresAt ? fields.offerExpiresAt.toISOString() : null},
        updated_at = now()
    WHERE id = ${entryId} AND status = 'waiting'
    RETURNING id`);
  return r.rows.length > 0;
}

export async function revertAcceptedToWaiting(entryId: string): Promise<void> {
  await getDb().execute(sql`
    UPDATE waitlist_entries
    SET status = 'waiting', offered_at = NULL, offer_expires_at = NULL, updated_at = now()
    WHERE id = ${entryId} AND status = 'accepted' AND matched_appointment_id IS NULL`);
}

export async function attachAppointment(entryId: string, appointmentId: string): Promise<void> {
  await getDb().execute(sql`
    UPDATE waitlist_entries
    SET matched_appointment_id = ${appointmentId}, updated_at = now()
    WHERE id = ${entryId}`);
}

export async function expireStaleOffers(): Promise<
  Array<{ id: string; organization_id: string; calendar_id: string }>
> {
  const r = await getDb().execute(sql`
    UPDATE waitlist_entries
    SET status = 'waiting', offered_at = NULL, offer_expires_at = NULL, updated_at = now()
    WHERE status = 'offered' AND offer_expires_at IS NOT NULL AND offer_expires_at < now()
    RETURNING id, organization_id, calendar_id`);
  return r.rows as unknown as Array<{ id: string; organization_id: string; calendar_id: string }>;
}

/**
 * Sweep: entries cuja janela inteira já passou → 'expired' (terminal).
 * `preferred_date_to < (now() AT TIME ZONE 'UTC')::date` com `<` estrito:
 * só expira quando a data-fim ficou ESTRITAMENTE no passado (UTC). Fronteira
 * no dia-UTC, não no fuso local da org — uma entry pode persistir até ~24h
 * após a meia-noite local. Aceitável p/ um safety sweep grosseiro.
 */
export async function expireStaleWaiting(): Promise<number> {
  const r = await getDb().execute(sql`
    UPDATE waitlist_entries
    SET status = 'expired', updated_at = now()
    WHERE status = 'waiting'
      AND preferred_date_to IS NOT NULL
      AND preferred_date_to < (now() AT TIME ZONE 'UTC')::date`);
  return r.rowCount ?? 0;
}

/**
 * Sweep simétrico ao expireStaleOffers: reverte entries presas em
 * 'accepted' sem appointment vinculado (worker morreu entre o CAS-claim
 * 'accepted' e o attachAppointment) de volta a 'waiting'. Guarda
 * matched_appointment_id IS NULL → nunca reverte um match concluído
 * (idempotente, mesmo predicado de revertAcceptedToWaiting + janela
 * temporal p/ não competir com um match em andamento).
 *
 * Crash-safe: o NOT EXISTS cruza com `appointments` pelas convenções de
 * idempotency-key (`wl-accept:<id>` do /accept; `wl:<id>:<slotIso>` do
 * auto_book) — só reverte uma entry presa em 'accepted' quando NENHUM
 * appointment foi de fato criado a partir dela. Assim um crash entre o
 * createAppointment e o attachAppointment NUNCA causa re-match/double-book.
 * Resíduo aceito (V1 / follow-on leve): a entry pode ficar presa em
 * 'accepted' com appointment real porém matched_appointment_id NULL —
 * gap cosmético no vínculo, NÃO um double-book.
 */
export async function expireStaleAccepted(olderThanMinutes: number): Promise<number> {
  const r = await getDb().execute(sql`
    UPDATE waitlist_entries
    SET status = 'waiting', offered_at = NULL, offer_expires_at = NULL, updated_at = now()
    WHERE status = 'accepted' AND matched_appointment_id IS NULL
      AND updated_at < now() - (${olderThanMinutes} || ' minutes')::interval
      AND NOT EXISTS (
        SELECT 1 FROM appointments a
        WHERE a.organization_id = waitlist_entries.organization_id
          AND (a.idempotency_key = 'wl-accept:' || waitlist_entries.id::text
               OR a.idempotency_key LIKE 'wl:' || waitlist_entries.id::text || ':%'))
  `);
  return r.rowCount ?? 0;
}

export async function insertWaitlistEntry(input: {
  organizationId: string;
  calendarId: string;
  serviceId: string | null;
  professionalId: string | null;
  customerId: string | null;
  customerName: string | null;
  customerPhone: string | null;
  customerEmail: string | null;
  preferredDateFrom: string | null;
  preferredDateTo: string | null;
  preferredTimeFrom: string | null;
  preferredTimeTo: string | null;
  priorityScore: number;
}): Promise<string> {
  const id = uuidv7();
  await getDb().execute(sql`
    INSERT INTO waitlist_entries
      (id, organization_id, calendar_id, service_id, professional_id, customer_id,
       customer_name, customer_phone, customer_email,
       preferred_date_from, preferred_date_to, preferred_time_from, preferred_time_to,
       status, priority_score)
    VALUES (${id}, ${input.organizationId}, ${input.calendarId}, ${input.serviceId},
            ${input.professionalId}, ${input.customerId}, ${input.customerName},
            ${input.customerPhone}, ${input.customerEmail}, ${input.preferredDateFrom},
            ${input.preferredDateTo}, ${input.preferredTimeFrom}, ${input.preferredTimeTo},
            'waiting', ${input.priorityScore})`);
  return id;
}

export async function serviceAllowsWaitlist(
  orgId: string,
  serviceId: string | null,
): Promise<boolean> {
  if (!serviceId) return true;
  const r = await getDb().execute(sql`
    SELECT allow_waitlist FROM services
    WHERE id = ${serviceId} AND organization_id = ${orgId} AND is_active = true LIMIT 1`);
  const row = r.rows[0] as { allow_waitlist: boolean } | undefined;
  return row?.allow_waitlist === true;
}

export async function loadWaitlistPolicyJson(serviceId: string | null): Promise<unknown> {
  if (!serviceId) return null;
  const r = await getDb().execute(sql`
    SELECT waitlist_policy_json FROM service_policies WHERE service_id = ${serviceId} LIMIT 1`);
  const row = r.rows[0] as { waitlist_policy_json: unknown } | undefined;
  return row?.waitlist_policy_json ?? null;
}

export async function insertWaitlistAudit(input: {
  organizationId: string;
  entryId: string;
  action: string;
  afterJson: Record<string, unknown>;
}): Promise<void> {
  await getDb().execute(sql`
    INSERT INTO audit_events
      (organization_id, entity_type, entity_id, action, actor_type, actor_id,
       reason_text, execution_id, after_json)
    VALUES (${input.organizationId}, 'waitlist_entry', ${input.entryId},
            ${input.action}, 'system', NULL, NULL, NULL,
            ${JSON.stringify(input.afterJson)}::jsonb)`);
}

export async function listEntries(
  orgId: string,
  calendarId: string,
  status?: string,
): Promise<Array<Record<string, unknown>>> {
  const r = await getDb().execute(sql`
    SELECT id, calendar_id, service_id, professional_id, customer_name,
           customer_phone, customer_email, preferred_date_from, preferred_date_to,
           preferred_time_from, preferred_time_to, status, priority_score,
           priority, position, offered_at, offer_expires_at,
           matched_appointment_id, created_at, updated_at
    FROM waitlist_entries
    WHERE organization_id = ${orgId} AND calendar_id = ${calendarId}
      AND (${status ?? null}::text IS NULL OR status = ${status ?? null})
    ORDER BY priority_score DESC, priority DESC,
             position ASC NULLS LAST, created_at ASC
    LIMIT 200`);
  return r.rows as Array<Record<string, unknown>>;
}

export async function getEntry(
  orgId: string,
  entryId: string,
): Promise<Record<string, unknown> | null> {
  const r = await getDb().execute(sql`
    SELECT * FROM waitlist_entries
    WHERE id = ${entryId} AND organization_id = ${orgId} LIMIT 1`);
  return (r.rows[0] as Record<string, unknown> | undefined) ?? null;
}

export async function patchEntry(
  orgId: string,
  entryId: string,
  patch: {
    priority_score?: number;
    priority?: number;
    customer_name?: string;
    customer_phone?: string;
    customer_email?: string;
    cancel?: boolean;
  },
): Promise<boolean> {
  const r = await getDb().execute(sql`
    UPDATE waitlist_entries SET
      priority_score = COALESCE(${patch.priority_score ?? null}, priority_score),
      priority = COALESCE(${patch.priority ?? null}, priority),
      customer_name = COALESCE(${patch.customer_name ?? null}, customer_name),
      customer_phone = COALESCE(${patch.customer_phone ?? null}, customer_phone),
      customer_email = COALESCE(${patch.customer_email ?? null}, customer_email),
      status = CASE WHEN ${patch.cancel ?? false} THEN 'cancelled' ELSE status END,
      updated_at = now()
    WHERE id = ${entryId} AND organization_id = ${orgId}
    RETURNING id`);
  return r.rows.length > 0;
}

/**
 * Staff aceita uma oferta: só se ainda 'offered'. Devolve os dados p/ o
 * caller criar o appointment (mesmo caminho do auto_book).
 */
export async function casAcceptOffered(
  orgId: string,
  entryId: string,
): Promise<{
  service_id: string | null;
  professional_id: string | null;
  customer_id: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  customer_email: string | null;
  calendar_id: string;
} | null> {
  const r = await getDb().execute(sql`
    UPDATE waitlist_entries SET status = 'accepted', updated_at = now()
    WHERE id = ${entryId} AND organization_id = ${orgId} AND status = 'offered'
    RETURNING calendar_id, service_id, professional_id, customer_id,
              customer_name, customer_phone, customer_email`);
  const row = r.rows[0] as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    calendar_id: row.calendar_id as string,
    service_id: (row.service_id as string | null) ?? null,
    professional_id: (row.professional_id as string | null) ?? null,
    customer_id: (row.customer_id as string | null) ?? null,
    customer_name: (row.customer_name as string | null) ?? null,
    customer_phone: (row.customer_phone as string | null) ?? null,
    customer_email: (row.customer_email as string | null) ?? null,
  };
}
