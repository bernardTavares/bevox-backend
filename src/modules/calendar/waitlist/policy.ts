/**
 * Parse puro de service_policies.waitlist_policy_json. NÃO existe schema
 * canon (só 4 dimensões no glossário) — forma mínima, defaults seguros.
 * NUNCA lança: input inválido/parcial → defaults (catchall com .catch()).
 */
import { z } from "zod";

const ORDER_TOKENS = ["priority_score", "priority", "position", "created_at"] as const;

const schema = z.object({
  mode: z.enum(["auto_book", "offer"]).catch("auto_book"),
  offer_window_minutes: z.coerce.number().int().positive().max(10080).catch(120),
  service_eligibility: z.enum(["exact", "any"]).catch("exact"),
  professional_preference: z.enum(["required", "preferred", "ignore"]).catch("preferred"),
  priority_order: z
    .array(z.enum(ORDER_TOKENS))
    .nonempty()
    .catch(() => [...ORDER_TOKENS]),
});

export type WaitlistPolicy = z.infer<typeof schema>;

const DEFAULTS: WaitlistPolicy = {
  mode: "auto_book",
  offer_window_minutes: 120,
  service_eligibility: "exact",
  professional_preference: "preferred",
  priority_order: [...ORDER_TOKENS],
};

export function parseWaitlistPolicy(json: unknown): WaitlistPolicy {
  if (json === null || json === undefined || typeof json !== "object") {
    return structuredClone(DEFAULTS);
  }
  const r = schema.safeParse(json);
  return r.success ? r.data : structuredClone(DEFAULTS);
}
