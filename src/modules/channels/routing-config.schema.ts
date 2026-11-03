/**
 * Canonical `channel_connections.routing_config_json` schema (C-owned).
 * The typed slice shared by the 3 consumers:
 *  - B1 ingestion seam: webhook_secret_ref (env var NAME), allowed_event_types
 *  - D autonomy: ai_mode_override
 *  - B2 pipeline: buffer_enabled, buffer_cutoff_seconds, processing_endpoint_url
 * All optional; consumers resolve channel-value > org/hardcoded default.
 * `passthrough()` so future keys do not break parsing.
 */

import { z } from "zod";

export const routingConfigSchema = z
  .object({
    webhook_secret_ref: z.string().min(1).optional(),
    allowed_event_types: z.array(z.string()).optional(),
    ai_mode_override: z.enum(["manual_assisted", "copilot", "autonomous_supervised"]).optional(),
    buffer_enabled: z.boolean().optional(),
    buffer_cutoff_seconds: z.number().int().positive().optional(),
    processing_endpoint_url: z.string().url().optional(),
  })
  .passthrough();

export type RoutingConfig = z.infer<typeof routingConfigSchema>;

/** Safe parse: never throws; unknown/invalid → {}. */
export function parseRoutingConfig(raw: unknown): RoutingConfig {
  const res = routingConfigSchema.safeParse(raw ?? {});
  return res.success ? res.data : {};
}
