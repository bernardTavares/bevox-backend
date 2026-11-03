/**
 * Engine de disponibilidade (getAvailableSlots).
 * Lê services/professionals/professional_services (org-scoped) +
 * professional_schedules/overrides (TIME) + system_holidays; conta
 * appointments por overlap timestamptz na tz do calendar. Funções de
 * tempo = port verbatim (unit-testadas).
 */
import { sql } from "drizzle-orm";
import { getDb } from "@/db/client.js";
import { errors } from "@/shared/errors.js";

export function parseMinutes(t: string): number {
  const p = t.split(":");
  return Number(p[0]) * 60 + Number(p[1]);
}
export function formatTime(minutes: number): string {
  const h = Math.floor(minutes / 60)
    .toString()
    .padStart(2, "0");
  const m = (minutes % 60).toString().padStart(2, "0");
  return `${h}:${m}`;
}
export function subtractInterval(
  intervals: Array<[number, number]>,
  blockStart: number,
  blockEnd: number,
): Array<[number, number]> {
  const result: Array<[number, number]> = [];
  for (const [s, e] of intervals) {
    if (blockEnd <= s || blockStart >= e) result.push([s, e]);
    else {
      if (s < blockStart) result.push([s, blockStart]);
      if (blockEnd < e) result.push([blockEnd, e]);
    }
  }
  return result;
}

export interface SlotMember {
  professional_id: string;
  name: string;
  remaining_capacity: number;
}
export interface Slot {
  start_time: string;
  end_time: string;
  available_members: SlotMember[];
}

/**
 * Disponibilidade de UM dia (date YYYY-MM-DD) p/ um serviço, na tz do
 * calendar. Elegíveis =
 * professional_services do service ∧ professionals.is_bookable∧is_active;
 * se nenhum vínculo, fallback = todos professionals org bookable∧active.
 */
export async function getAvailableSlots(input: {
  organizationId: string;
  calendarId: string;
  serviceId: string;
  date: string;
}): Promise<{
  date: string;
  calendar_id: string;
  service: { id: string; name: string; duration_minutes: number };
  slots: Slot[];
}> {
  const db = getDb();
  const { organizationId, calendarId, serviceId, date } = input;

  const calR = await db.execute(
    sql`SELECT timezone FROM calendars WHERE id = ${calendarId} AND organization_id = ${organizationId} AND is_active = true LIMIT 1`,
  );
  const cal = calR.rows[0] as { timezone: string } | undefined;
  if (!cal) throw errors.notFound("Calendar", calendarId);

  const svcR = await db.execute(
    sql`SELECT id, name, duration_minutes, max_concurrent FROM services WHERE id = ${serviceId} AND organization_id = ${organizationId} AND is_active = true LIMIT 1`,
  );
  const svc = svcR.rows[0] as
    | { id: string; name: string; duration_minutes: number; max_concurrent: number }
    | undefined;
  if (!svc) throw errors.notFound("Service", serviceId);

  const linked = await db.execute(sql`
    SELECT p.id, p.name FROM professionals p
    JOIN professional_services ps ON ps.professional_id = p.id
    WHERE ps.service_id = ${serviceId} AND p.organization_id = ${organizationId}
      AND p.is_bookable = true AND p.is_active = true`);
  let members = linked.rows as Array<{ id: string; name: string }>;
  if (members.length === 0) {
    const all = await db.execute(
      sql`SELECT id, name FROM professionals WHERE organization_id = ${organizationId} AND is_bookable = true AND is_active = true`,
    );
    members = all.rows as Array<{ id: string; name: string }>;
  }
  if (members.length === 0)
    return {
      date,
      calendar_id: calendarId,
      service: { id: svc.id, name: svc.name, duration_minutes: svc.duration_minutes },
      slots: [],
    };

  const [, mo, d] = date.split("-").map(Number) as [number, number, number];
  const dayOfWeek = new Date(`${date}T00:00:00`).getDay();

  const holR = await db.execute(sql`
    SELECT 1 FROM system_holidays WHERE country_code = 'BR'
      AND (date = ${date} OR (is_recurring = true AND EXTRACT(MONTH FROM date) = ${mo} AND EXTRACT(DAY FROM date) = ${d})) LIMIT 1`);
  const isSystemHoliday = holR.rows.length > 0;

  const slotMap = new Map<string, SlotMember[]>();
  for (const member of members) {
    const schR = await db.execute(
      sql`SELECT start_time, end_time, break_start, break_end FROM professional_schedules WHERE professional_id = ${member.id} AND day_of_week = ${dayOfWeek}`,
    );
    const sched = schR.rows[0] as
      | {
          start_time: string;
          end_time: string;
          break_start: string | null;
          break_end: string | null;
        }
      | undefined;
    if (!sched) continue;

    const ovR = await db.execute(
      sql`SELECT type, start_time, end_time FROM professional_schedule_overrides WHERE professional_id = ${member.id} AND date = ${date}`,
    );
    const overrides = ovR.rows as Array<{
      type: string;
      start_time: string | null;
      end_time: string | null;
    }>;
    if (isSystemHoliday || overrides.some((o) => o.type === "holiday")) continue;

    let intervals: Array<[number, number]> = [
      [parseMinutes(sched.start_time), parseMinutes(sched.end_time)],
    ];
    if (sched.break_start && sched.break_end)
      intervals = subtractInterval(
        intervals,
        parseMinutes(sched.break_start),
        parseMinutes(sched.break_end),
      );
    for (const o of overrides) {
      if (o.type === "block" && o.start_time && o.end_time)
        intervals = subtractInterval(
          intervals,
          parseMinutes(o.start_time),
          parseMinutes(o.end_time),
        );
      else if (o.type === "extra" && o.start_time && o.end_time) {
        intervals.push([parseMinutes(o.start_time), parseMinutes(o.end_time)]);
        intervals.sort((a, b) => a[0] - b[0]);
      }
    }

    for (const [iStart, iEnd] of intervals) {
      let slotStart = iStart;
      while (slotStart + svc.duration_minutes <= iEnd) {
        const slotEnd = slotStart + svc.duration_minutes;
        const startFmt = formatTime(slotStart);
        const endFmt = formatTime(slotEnd);
        // overlap por timestamptz na tz do calendar (reconciliação)
        const cR = await db.execute(sql`
          SELECT COUNT(*)::int AS count FROM appointments
          WHERE professional_id = ${member.id} AND status NOT IN ('cancelled')
            AND start_at < ((${date} || ' ' || ${endFmt})::timestamp AT TIME ZONE ${cal.timezone})
            AND end_at   > ((${date} || ' ' || ${startFmt})::timestamp AT TIME ZONE ${cal.timezone})`);
        const booked = Number((cR.rows[0] as { count: number }).count ?? 0);
        const remaining = svc.max_concurrent - booked;
        if (remaining > 0) {
          const key = `${startFmt}-${endFmt}`;
          const entry: SlotMember = {
            professional_id: member.id,
            name: member.name,
            remaining_capacity: remaining,
          };
          const ex = slotMap.get(key);
          if (ex) ex.push(entry);
          else slotMap.set(key, [entry]);
        }
        slotStart += svc.duration_minutes;
      }
    }
  }

  const slots: Slot[] = Array.from(slotMap.entries())
    .map(([k, am]) => {
      const [s, e] = k.split("-") as [string, string];
      return { start_time: s, end_time: e, available_members: am };
    })
    .sort((a, b) => a.start_time.localeCompare(b.start_time));
  return {
    date,
    calendar_id: calendarId,
    service: { id: svc.id, name: svc.name, duration_minutes: svc.duration_minutes },
    slots,
  };
}
