/**
 * Seam-context M3-C1: resolve o contexto de calendar para uma proposal
 * da IA (consumida pelo seam executeProposals). SQL parametrizado via
 * getDb(); sem import estático de @/db/schema (idioma irmão booking.ts).
 *
 * CONTRATO DO `params` (ASSUMIDO, documentado):
 *   O schema canônico do harness define a proposal como
 *   `{ action, params: Record<string,unknown>, idempotency_key }`
 *   (src/integration/harness-callbacks.schema.ts:ProposalSchema). `params`
 *   é OPACO (z.record(z.string(), z.unknown())) — não há contrato de
 *   campos canônico no repo nem em $BEVOX_KNOWLEDGE_PATH (não setado neste
 *   ambiente; ADR-018 não localizável). Assume-se, por consume-by-reference
 *   e DOCUMENTADO aqui:
 *     - service_id:      string (UUID do service)            — create
 *     - start_at:        string ISO 8601 (instante UTC/offset) — create/reschedule
 *     - professional_id: string opcional (UUID)              — create/reschedule
 *     - appointment_id:  string (UUID)                       — reschedule/cancel
 *   Dado essencial ausente para a ação → retorna null (o seam emite um
 *   resultado HONESTO `error`; NUNCA fabrica data/serviço).
 *
 * Timezone: date (YYYY-MM-DD) e startTime (HH:MM) são derivados do
 * `start_at` NO FUSO do calendar default da org (NÃO slice de ISO UTC —
 * isso reintroduziria o bug de tz corrigido na Task 5). Conversão via
 * `(${startAt}::timestamptz AT TIME ZONE ${tz})` no Postgres.
 *
 * Calendar default da org = primeira linha `calendars` ativa da org
 * (V1; multi-calendar = futuro).
 */
import { sql } from "drizzle-orm";

import { getDb } from "@/db/client.js";

export interface ConversationCalendarContext {
  calendarId: string;
  calendarTimezone: string;
  serviceId: string;
  professionalId?: string;
  customerId?: string;
  customerName?: string;
  customerPhone?: string;
  date: string;
  startTime: string;
  appointmentId?: string;
}

function strParam(params: Record<string, unknown>, key: string): string | undefined {
  const v = params[key];
  return typeof v === "string" && v.trim().length > 0 ? v : undefined;
}

/**
 * Resolve o contexto de calendar para uma proposal. Retorna `null` se
 * QUALQUER dado essencial estiver ausente (calendar default inexistente,
 * `service_id`/`start_at` ausentes — exceto cancel, que só precisa de
 * appointment_id). Quem chama emite `error` honesto; nunca fabrica.
 */
export async function resolveConversationCalendarContext(
  organizationId: string,
  conversationId: string,
  params: Record<string, unknown>,
): Promise<ConversationCalendarContext | null> {
  const db = getDb();

  // Calendar default da org (V1: primeira ativa). Sua timezone é a
  // autoridade para derivar date/startTime do start_at ISO.
  const calR = await db.execute(
    sql`SELECT id, timezone FROM calendars
        WHERE organization_id = ${organizationId} AND is_active = true
        ORDER BY created_at ASC LIMIT 1`,
  );
  const cal = calR.rows[0] as { id: string; timezone: string } | undefined;
  if (!cal) return null;

  // Conversa (org-scoped) → customer_id; snapshot barato do customer.
  const convR = await db.execute(
    sql`SELECT c.customer_id, cu.full_name, cu.primary_phone
        FROM conversations c
        LEFT JOIN customers cu ON cu.id = c.customer_id
        WHERE c.id = ${conversationId} AND c.organization_id = ${organizationId}
        LIMIT 1`,
  );
  const conv = convR.rows[0] as
    | { customer_id: string | null; full_name: string | null; primary_phone: string | null }
    | undefined;
  if (!conv) return null;

  const serviceId = strParam(params, "service_id");
  const professionalId = strParam(params, "professional_id");
  const appointmentId = strParam(params, "appointment_id");
  const startAt = strParam(params, "start_at");

  // date/startTime no fuso do calendar default — conversão no Postgres
  // (NÃO slice de ISO UTC). Se start_at ausente ou não-parseável como
  // timestamptz, date/startTime ficam vazios (essencial p/ create/reschedule).
  let date = "";
  let startTime = "";
  if (startAt) {
    try {
      const tsR = await db.execute(
        sql`SELECT to_char((${startAt}::timestamptz AT TIME ZONE ${cal.timezone}), 'YYYY-MM-DD') AS d,
                   to_char((${startAt}::timestamptz AT TIME ZONE ${cal.timezone}), 'HH24:MI') AS t`,
      );
      const ts = tsR.rows[0] as { d: string | null; t: string | null } | undefined;
      date = ts?.d ?? "";
      startTime = ts?.t ?? "";
    } catch {
      // start_at não-parseável → date/startTime vazios → honest error a jusante.
      date = "";
      startTime = "";
    }
  }

  return {
    calendarId: cal.id,
    calendarTimezone: cal.timezone,
    serviceId: serviceId ?? "",
    professionalId,
    customerId: conv.customer_id ?? undefined,
    customerName: conv.full_name ?? undefined,
    customerPhone: conv.primary_phone ?? undefined,
    date,
    startTime,
    appointmentId,
  };
}
