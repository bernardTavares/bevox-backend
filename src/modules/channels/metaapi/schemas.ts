/**
 * Zod schemas para bevox-meta-api inbound events + verification challenge.
 *
 * Envelope canon (consumer-integration-guide §3.4):
 *   { event_id: UuidV7, event_type: string, tenant_id: UuidV7 | null, occurred_at: ISO8601, data: unknown }
 *
 * Marco 4 P1 (bevox-backend/ADR-019; ADR-012 consumer cutover).
 */

import { z } from "zod";

const UuidV7 = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/, "must be UUIDv7");

export const CANONICAL_EVENT_TYPES = [
  "message.received",
  "message.status_updated",
  "template.status_updated",
  "phone_number.quality_changed",
  "waba.connection_changed",
] as const;

export type CanonicalEventType = (typeof CANONICAL_EVENT_TYPES)[number];

// Event type accepts canonical OR raw.* fallback (meta-api emits raw.<object>.<field> for unmapped).
const eventTypeSchema = z
  .string()
  .refine(
    (v) =>
      CANONICAL_EVENT_TYPES.includes(v as CanonicalEventType) || /^raw\.[a-z_]+\.[a-z_]+$/.test(v),
    { message: "event_type must be canonical or raw.*" },
  );

export const metaApiEventEnvelopeSchema = z.object({
  event_id: UuidV7,
  event_type: eventTypeSchema,
  tenant_id: UuidV7.nullable(),
  occurred_at: z.string().datetime(),
  data: z.unknown(),
});

export type MetaApiEventEnvelope = z.infer<typeof metaApiEventEnvelopeSchema>;

export const metaApiVerificationChallengeSchema = z.object({
  verification_challenge: z.string().min(1).max(128),
});

export type MetaApiVerificationChallenge = z.infer<typeof metaApiVerificationChallengeSchema>;
