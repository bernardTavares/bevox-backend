import { z } from "zod";

/**
 * Zod schemas — staff-ops (B4, Módulo 17). Paginação clampa
 * page≥1 / perPage 1..100 (default 1/20).
 */

export const paginationSchema = z
  .object({ page: z.unknown().optional(), per_page: z.unknown().optional() })
  .transform(({ page, per_page }) => {
    const p = Number(page ?? 1);
    const pp = Number(per_page ?? 20);
    return {
      page: Math.max(Number.isFinite(p) ? Math.trunc(p) : 1, 1),
      perPage: Math.min(Math.max(Number.isFinite(pp) ? Math.trunc(pp) : 20, 1), 100),
    };
  });

/**
 * Envelope de listagem paginada — centraliza o cálculo de total_pages
 * (≥1) reutilizado pelos handlers de list (executions/windows/
 * dead-letters/audit-events). Shape/valores idênticos ao literal inline.
 */
export function paginated<T>(data: T[], page: number, perPage: number, total: number) {
  return {
    data,
    pagination: {
      page,
      per_page: perPage,
      total,
      total_pages: Math.max(1, Math.ceil(total / perPage)),
    },
  };
}

export const actionBodySchema = z
  // .trim() é proposital: o valor aparado é o que vai p/ o ledger/audit;
  // rejeita reason só-espaços (min(1) após trim).
  .object({ reason: z.string().trim().min(1) })
  .strict();

export const auditQuerySchema = z.object({
  organization_id: z.string().optional(),
  entity_type: z.string().optional(),
  entity_id: z.string().optional(),
  actor_id: z.string().optional(),
  actor_type: z.string().optional(),
  action: z.string().optional(),
  date_from: z.string().optional(),
  date_to: z.string().optional(),
});

export const listQuerySchema = z.object({
  organization_id: z.string().optional(),
  status: z.string().optional(),
  conversation_key: z.string().optional(),
  date_from: z.string().optional(),
  date_to: z.string().optional(),
});

export const idParam = z.object({ id: z.string().uuid() });

export type ActionBody = z.infer<typeof actionBodySchema>;
