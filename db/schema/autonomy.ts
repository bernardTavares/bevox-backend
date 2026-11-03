/**
 * Schema de autonomia — Modelo de Dados Produto §10.5 (AutonomyProfile).
 * Tenant = organization_id (ADR-021, supersedes §10.5 `workspace_id`
 * legado). `current_mode` usa o `aiModeEnum` já existente (ADR-018:
 * manual_assisted|copilot|autonomous_supervised) — canon diz `text`,
 * usamos pgEnum pois o valor é parte do contrato (convenção _shared.ts).
 * 1:1 por org (UNIQUE em organization_id); id surrogate PK pois canon
 * §10.5 define `id` explícito (difere de organization_settings/
 * service_policies que usam o FK do pai como PK). Histórico de
 * transições via `audit_events`.
 * `readiness_score` numeric SEM bound (range canônico §10.5 indefinido);
 * armazenado nullable. Follow-on pós-B2/FAQ: auto-cálculo + bound/CHECK
 * do range (modelar como customer_facts.confidence quando o range for
 * decidido no canon).
 */

import { jsonb, numeric, pgTable, uniqueIndex } from "drizzle-orm/pg-core";

import { organizations } from "./tenancy.js";
import { aiModeEnum, createdAt, organizationIdFk, updatedAt, uuidv7PrimaryKey } from "./_shared.js";

export const autonomyProfiles = pgTable(
  "autonomy_profiles",
  {
    id: uuidv7PrimaryKey(),
    organizationId: organizationIdFk()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    currentMode: aiModeEnum("current_mode").notNull().default("manual_assisted"),
    allowedActionsJson: jsonb("allowed_actions_json"),
    requiredApprovalsJson: jsonb("required_approvals_json"),
    confidenceThresholdsJson: jsonb("confidence_thresholds_json"),
    readinessScore: numeric("readiness_score"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => ({
    orgUniq: uniqueIndex("autonomy_profiles_organization_id_uniq").on(table.organizationId),
  }),
);

export type AutonomyProfile = typeof autonomyProfiles.$inferSelect;
export type NewAutonomyProfile = typeof autonomyProfiles.$inferInsert;
