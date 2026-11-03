/**
 * Zod schemas — organizations module (PRD §10.1). Tenant = organization_id
 * (ADR-021). Validation on ALL inputs.
 */

import { z } from "zod";

export const organizationIdParamSchema = z.object({
  organization_id: z.string().uuid(),
});

export const organizationPatchSchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    business_name: z.string().min(1).max(200).optional(),
    legal_name: z.string().max(200).optional(),
    niche: z.string().min(1).max(120).optional(),
    timezone: z.string().min(1).max(64).optional(),
    currency: z.string().min(3).max(3).optional(),
    locale: z.string().min(2).max(12).optional(),
  })
  .strict();

export const settingsPatchSchema = z
  .object({
    default_reply_tone: z.string().max(120).nullable().optional(),
    default_language: z.string().max(12).nullable().optional(),
    allow_same_day_booking: z.boolean().optional(),
    default_booking_notice_minutes: z.number().int().nonnegative().nullable().optional(),
    default_cancel_notice_minutes: z.number().int().nonnegative().nullable().optional(),
    default_reschedule_notice_minutes: z.number().int().nonnegative().nullable().optional(),
  })
  .strict();

export const onboardingAdvanceSchema = z
  .object({
    stage: z.enum([
      "welcome",
      "business_profile",
      "professionals",
      "services",
      "schedule",
      "calendar_sync",
      "channels",
      "payments",
      "knowledge",
      "manual_assisted",
      "copilot_active",
    ]),
  })
  .strict();

export type OrganizationPatch = z.infer<typeof organizationPatchSchema>;
export type SettingsPatch = z.infer<typeof settingsPatchSchema>;
