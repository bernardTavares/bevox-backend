/** Calendar repo (M3-C1). SQL parametrizado getDb()/tx; sem import @/db/schema. */
import { sql } from "drizzle-orm";

import { getDb } from "@/db/client.js";
import { errors } from "@/shared/errors.js";
import { uuidv7 } from "@/shared/uuid.js";

import { enqueueMatchIntentTx } from "./waitlist/repository.js";

export async function findCalendar(orgId: string, id: string) {
  const r = await getDb().execute(
    sql`SELECT id, timezone, name, is_active FROM calendars WHERE id = ${id} AND organization_id = ${orgId} LIMIT 1`,
  );
  return (
    (r.rows[0] as { id: string; timezone: string; name: string; is_active: boolean } | undefined) ??
    null
  );
}

export async function createCalendar(orgId: string, name: string, timezone: string) {
  const id = uuidv7();
  await getDb().execute(
    sql`INSERT INTO calendars (id, organization_id, name, timezone) VALUES (${id}, ${orgId}, ${name}, ${timezone})`,
  );
  return findCalendar(orgId, id);
}

export async function listCalendars(orgId: string) {
  const r = await getDb().execute(
    sql`SELECT id, name, timezone, is_active, created_at FROM calendars WHERE organization_id = ${orgId} ORDER BY created_at DESC LIMIT 200`,
  );
  return r.rows;
}

export async function getServicePolicy(orgId: string, serviceId: string) {
  const r = await getDb().execute(sql`
    SELECT sp.booking_notice_minutes, sp.reschedule_notice_minutes, sp.cancel_notice_minutes
    FROM service_policies sp JOIN services s ON s.id = sp.service_id
    WHERE sp.service_id = ${serviceId} AND s.organization_id = ${orgId} LIMIT 1`);
  return (
    (r.rows[0] as
      | {
          booking_notice_minutes: number | null;
          reschedule_notice_minutes: number | null;
          cancel_notice_minutes: number | null;
        }
      | undefined) ?? null
  );
}

export async function findAppointment(orgId: string, id: string) {
  const r = await getDb().execute(
    sql`SELECT * FROM appointments WHERE id = ${id} AND organization_id = ${orgId} LIMIT 1`,
  );
  return (r.rows[0] as Record<string, unknown> | undefined) ?? null;
}

export async function setAppointmentStatus(
  orgId: string,
  id: string,
  status: string,
  reason?: string | null,
) {
  const r = await getDb().execute(sql`
    UPDATE appointments SET status = ${status}, updated_at = now(),
      cancelled_at = CASE WHEN ${status} = 'cancelled' THEN now() ELSE cancelled_at END,
      cancellation_reason = CASE WHEN ${status} = 'cancelled' THEN ${reason ?? null} ELSE cancellation_reason END
    WHERE id = ${id} AND organization_id = ${orgId} RETURNING id`);
  return r.rows.length > 0;
}

/**
 * Cria um professional_schedule_override (net-new C3 — antes só havia
 * leitura em availability.ts). Quando type='extra' e a janela é futura,
 * enfileira waitlist_match_outbox na MESMA tx (capacidade adicionada).
 * block/holiday reduzem capacidade → nenhum intent.
 */
export async function createScheduleOverride(
  orgId: string,
  professionalId: string,
  b: {
    date: string;
    type: "block" | "extra" | "holiday";
    start_time?: string;
    end_time?: string;
    reason?: string;
  },
): Promise<{ id: string }> {
  const prof = await getDb().execute(
    sql`SELECT id FROM professionals WHERE id = ${professionalId} AND organization_id = ${orgId} LIMIT 1`,
  );
  if (prof.rows.length === 0) throw errors.notFound("Professional", professionalId);

  const id = uuidv7();
  await getDb().transaction(async (tx) => {
    await tx.execute(sql`
      INSERT INTO professional_schedule_overrides
        (id, organization_id, professional_id, date, type, start_time, end_time, reason)
      VALUES (${id}, ${orgId}, ${professionalId}, ${b.date}, ${b.type},
              ${b.start_time ?? null}, ${b.end_time ?? null}, ${b.reason ?? null})`);

    if (b.type === "extra" && b.start_time) {
      // V1 deliberada: o override é professional-scoped (sem dimensão de
      // calendar). Resolvemos o calendar mais antigo da org como alvo do
      // match-intent. Imprecisão conhecida em orgs multi-calendar — o match
      // (Task 7) é per-calendar + CAS, então o pior caso é um no-op (nenhum
      // candidato waiting naquele calendar), nunca um booking errado.
      // Follow-on: modelar professional→calendar p/ alvo preciso.
      const cal = await tx.execute(sql`
        SELECT c.id AS calendar_id
        FROM calendars c
        WHERE c.organization_id = ${orgId}
        ORDER BY c.created_at ASC LIMIT 1`);
      const calRow = cal.rows[0] as { calendar_id: string } | undefined;
      if (calRow) {
        const slotStartAt = new Date(`${b.date}T${b.start_time}:00Z`);
        await enqueueMatchIntentTx(tx, {
          organizationId: orgId,
          calendarId: calRow.calendar_id,
          slotStartAt,
          serviceId: null,
          professionalId,
        });
      }
    }
  });
  return { id };
}
