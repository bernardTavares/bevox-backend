/**
 * Handler da action seam `waitlist-add` (ADR-018). Valida params (zod
 * strict, fail-closed deliberado: chave extra desconhecida → error honesto
 * em vez de aceitar silenciosamente) ANTES de tocar o DB → falha = error
 * honesto sem escrita parcial. Idempotência: o idempotency_key vem do
 * harness no Proposal (harness-callbacks.schema.ts: z.string().min(1),
 * sempre não-nulo); o backend NÃO computa sha256 — usa um dedup Redis
 * waitlist:idem:.
 *
 * RISCO RESIDUAL V1 (documentado, aceito): ao contrário de booking
 * (appointments tem o índice único appointments_org_idempotency_uniq como
 * rede DB), waitlist_entries NÃO tem índice único em
 * (organization_id, idempotency_key). O caso dominante (ADR-015) é replay
 * SEQUENCIAL do mesmo proposal → o 2º acerta a chave Redis e é deduplicado
 * corretamente. Só o double-fire CONCORRENTE da MESMA chave (ambos perdem
 * o GET) insere 2 entries — raro. Mitigação (follow-on, fora do escopo
 * desta task pois exige migration): coluna idempotency_key em
 * waitlist_entries + índice único parcial + catch 23505 espelhando
 * isIdempotencyUniqueViolation de booking.ts.
 */
import { z } from "zod";

import { getRedis } from "@/lib/redis.js";

import { waitlistIdemKey, WAITLIST_IDEM_TTL_SECONDS } from "./constants.js";
import { insertWaitlistEntry, serviceAllowsWaitlist } from "./repository.js";

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const hm = z.string().regex(/^\d{2}:\d{2}$/);

const paramsSchema = z
  .object({
    calendar_id: z.string().uuid(),
    service_id: z.string().uuid().optional(),
    professional_id: z.string().uuid().optional(),
    customer_id: z.string().uuid().optional(),
    customer_name: z.string().min(1).max(200).optional(),
    customer_phone: z.string().min(1).max(40).optional(),
    customer_email: z.string().email().optional(),
    preferred_date_from: ymd.optional(),
    preferred_date_to: ymd.optional(),
    preferred_time_from: hm.optional(),
    preferred_time_to: hm.optional(),
    priority_score: z.coerce.number().finite().optional(),
  })
  .strict();

export type WaitlistAddOutcome =
  | { status: "success"; waitlist_entry_id: string }
  | { status: "error" };

export async function handleWaitlistAdd(
  organizationId: string,
  rawParams: Record<string, unknown>,
  idempotencyKey: string,
): Promise<WaitlistAddOutcome> {
  const parsed = paramsSchema.safeParse(rawParams);
  if (!parsed.success) return { status: "error" };
  const p = parsed.data;

  const redis = getRedis();
  const idemK = waitlistIdemKey(organizationId, idempotencyKey);
  const cached = await redis.get(idemK);
  if (cached) return { status: "success", waitlist_entry_id: cached };

  if (!(await serviceAllowsWaitlist(organizationId, p.service_id ?? null))) {
    return { status: "error" };
  }

  const id = await insertWaitlistEntry({
    organizationId,
    calendarId: p.calendar_id,
    serviceId: p.service_id ?? null,
    professionalId: p.professional_id ?? null,
    customerId: p.customer_id ?? null,
    customerName: p.customer_name ?? null,
    customerPhone: p.customer_phone ?? null,
    customerEmail: p.customer_email ?? null,
    preferredDateFrom: p.preferred_date_from ?? null,
    preferredDateTo: p.preferred_date_to ?? null,
    preferredTimeFrom: p.preferred_time_from ?? null,
    preferredTimeTo: p.preferred_time_to ?? null,
    priorityScore: p.priority_score ?? 0,
  });
  await redis.set(idemK, id, "EX", WAITLIST_IDEM_TTL_SECONDS);
  return { status: "success", waitlist_entry_id: id };
}
