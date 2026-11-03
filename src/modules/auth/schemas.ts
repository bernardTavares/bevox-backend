/**
 * Schemas Zod do módulo auth (staff Bevox) — ADR-013.
 *
 * Fonte canônica do contrato HTTP de sessões/refresh/impersonation +
 * webhook Clerk. Validação obrigatória em TODA entrada (PRD §8).
 */

import { z } from "zod";

const UuidV7 = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/, {
    message: "Must be a UUIDv7",
  });

// ----- Staff sessions -----

export const staffLoginBodySchema = z.object({
  email: z.string().email().max(320),
  password: z.string().min(1).max(512),
});
export type StaffLoginBody = z.infer<typeof staffLoginBodySchema>;

export const staffRefreshBodySchema = z.object({
  refresh_token: z.string().min(1).max(200),
});
export type StaffRefreshBody = z.infer<typeof staffRefreshBodySchema>;

// ----- Impersonation -----

export const impersonationCategorySchema = z.enum(["support", "audit", "incident"]);

export const impersonationStartBodySchema = z.object({
  reason: z.string().min(1).max(2000),
  category: impersonationCategorySchema,
});
export type ImpersonationStartBody = z.infer<typeof impersonationStartBodySchema>;

export const organizationIdParamSchema = z.object({
  organization_id: UuidV7,
});

// ----- Clerk webhook -----

// Svix verifica a assinatura; o corpo já-verificado é destruturado leniente.
export const clerkWebhookEventSchema = z.object({
  type: z.string().min(1),
  data: z.record(z.string(), z.unknown()),
});
export type ClerkWebhookEvent = z.infer<typeof clerkWebhookEventSchema>;
