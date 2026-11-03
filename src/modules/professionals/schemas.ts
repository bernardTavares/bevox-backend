/**
 * Zod schemas — professionals module (PRD §10.1). organization_id-scoped.
 */

import { z } from "zod";

export const orgParamSchema = z.object({
  organization_id: z.string().uuid(),
});

export const orgIdParamSchema = z.object({
  organization_id: z.string().uuid(),
  id: z.string().uuid(),
});

const roleType = z.enum(["provider", "operator", "provider_operator"]);

export const professionalCreateSchema = z
  .object({
    name: z.string().min(1).max(200),
    email: z.string().email().max(320).optional(),
    phone: z.string().max(40).optional(),
    role_type: roleType,
    bio: z.string().max(4000).optional(),
    is_bookable: z.boolean().optional(),
    can_take_handoffs: z.boolean().optional(),
  })
  .strict();

export const professionalPatchSchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    email: z.string().email().max(320).nullable().optional(),
    phone: z.string().max(40).nullable().optional(),
    role_type: roleType.optional(),
    bio: z.string().max(4000).nullable().optional(),
    is_bookable: z.boolean().optional(),
    can_take_handoffs: z.boolean().optional(),
    is_active: z.boolean().optional(),
  })
  .strict();

export type ProfessionalCreate = z.infer<typeof professionalCreateSchema>;
export type ProfessionalPatch = z.infer<typeof professionalPatchSchema>;
