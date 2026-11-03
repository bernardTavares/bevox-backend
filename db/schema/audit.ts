/**
 * Audit log — PRD §11 (Modelo de Dados §12).
 *
 * Trilha append-only de mutações. Tenant-scoped por `organization_id`
 * (ADR-021). `actor_type` identifica origem da ação.
 */

import { index, jsonb, pgTable, text } from "drizzle-orm/pg-core";

import { executions } from "./executions.js";
import { organizations } from "./tenancy.js";
import {
  auditActorTypeEnum,
  createdAt,
  organizationIdFk,
  uuidFk,
  uuidv7PrimaryKey,
} from "./_shared.js";

export const auditEvents = pgTable(
  "audit_events",
  {
    id: uuidv7PrimaryKey(),
    organizationId: organizationIdFk()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    entityType: text("entity_type").notNull(),
    entityId: uuidFk("entity_id"),
    action: text("action").notNull(),
    actorType: auditActorTypeEnum("actor_type").notNull(),
    actorId: uuidFk("actor_id"),
    reasonText: text("reason_text"),
    beforeJson: jsonb("before_json"),
    afterJson: jsonb("after_json"),
    executionId: uuidFk("execution_id").references(() => executions.id, {
      onDelete: "set null",
    }),
    createdAt: createdAt(),
  },
  (table) => ({
    orgCreatedIdx: index("audit_events_org_created_idx").on(table.organizationId, table.createdAt),
    entityIdx: index("audit_events_entity_idx").on(table.entityType, table.entityId),
  }),
);

export type AuditEvent = typeof auditEvents.$inferSelect;
export type NewAuditEvent = typeof auditEvents.$inferInsert;
