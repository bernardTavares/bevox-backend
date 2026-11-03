/**
 * Zod schemas — customers module (PRD §10.1). organization_id-scoped.
 */

import { z } from "zod";

export const orgParamSchema = z.object({
  organization_id: z.string().uuid(),
});

export const orgIdParamSchema = z.object({
  organization_id: z.string().uuid(),
  id: z.string().uuid(),
});

export const customerIdParamSchema = z.object({
  id: z.string().uuid(),
});

export const customerCreateSchema = z
  .object({
    full_name: z.string().min(1).max(200),
    preferred_name: z.string().max(120).optional(),
    primary_phone: z.string().max(40).optional(),
    primary_email: z.string().email().max(320).optional(),
    notes_internal: z.string().max(8000).optional(),
  })
  .strict();

export const customerPatchSchema = z
  .object({
    full_name: z.string().min(1).max(200).optional(),
    preferred_name: z.string().max(120).nullable().optional(),
    primary_phone: z.string().max(40).nullable().optional(),
    primary_email: z.string().email().max(320).nullable().optional(),
    notes_internal: z.string().max(8000).nullable().optional(),
    ai_opt_out: z.boolean().optional(),
  })
  .strict();

export const factCreateSchema = z
  .object({
    fact_key: z.string().min(1).max(200),
    fact_value: z.string().min(1).max(4000),
    category: z.string().max(120).optional(),
    confidence: z.number().min(0).max(1).optional(),
    source_type: z.enum(["ai_extracted", "manual", "imported"]).default("manual"),
    is_private: z.boolean().optional(),
  })
  .strict();

export type CustomerCreate = z.infer<typeof customerCreateSchema>;
export type CustomerPatch = z.infer<typeof customerPatchSchema>;
export type FactCreate = z.infer<typeof factCreateSchema>;
