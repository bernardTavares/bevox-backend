/**
 * Zod schemas — services module (PRD §10.1). organization_id-scoped.
 */

import { z } from "zod";

export const orgParamSchema = z.object({
  organization_id: z.string().uuid(),
});

export const orgIdParamSchema = z.object({
  organization_id: z.string().uuid(),
  id: z.string().uuid(),
});

export const serviceCreateSchema = z
  .object({
    name: z.string().min(1).max(200),
    category: z.string().max(120).optional(),
    description: z.string().max(4000).optional(),
    duration_minutes: z.number().int().positive(),
    price_amount: z.number().nonnegative().optional(),
    currency: z.string().min(3).max(3),
    max_concurrent: z.number().int().positive().optional(),
    requires_prepayment: z.boolean().optional(),
    requires_human_approval: z.boolean().optional(),
  })
  .strict();

export const servicePatchSchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    category: z.string().max(120).nullable().optional(),
    description: z.string().max(4000).nullable().optional(),
    duration_minutes: z.number().int().positive().optional(),
    price_amount: z.number().nonnegative().nullable().optional(),
    currency: z.string().min(3).max(3).optional(),
    max_concurrent: z.number().int().positive().optional(),
    requires_prepayment: z.boolean().optional(),
    requires_human_approval: z.boolean().optional(),
    is_active: z.boolean().optional(),
  })
  .strict();

export type ServiceCreate = z.infer<typeof serviceCreateSchema>;
export type ServicePatch = z.infer<typeof servicePatchSchema>;
