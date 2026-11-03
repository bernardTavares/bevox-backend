/**
 * Schema de execution traces — Modelo §10.7 / PRD §11.2. Tenant =
 * organization_id UUID (ADR-021); UUIDv7 PK (ADR-001).
 */

import { boolean, index, integer, jsonb, pgTable, text } from "drizzle-orm/pg-core";

import { executions } from "./executions.js";
import { organizations } from "./tenancy.js";
import { createdAt, organizationIdFk, uuidFk, uuidv7PrimaryKey } from "./_shared.js";

export const executionTraces = pgTable(
  "execution_traces",
  {
    id: uuidv7PrimaryKey(),
    executionId: uuidFk("execution_id")
      .notNull()
      .references(() => executions.id, { onDelete: "cascade" }),
    organizationId: organizationIdFk()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    stepType: text("step_type").notNull(),
    stepName: text("step_name").notNull(),
    isCritical: boolean("is_critical").notNull().default(false),
    ingestStatus: text("ingest_status").notNull().default("ingested"),
    ingestAttempts: integer("ingest_attempts").notNull().default(0),
    ingestError: text("ingest_error"),
    inputJson: jsonb("input_json"),
    outputJson: jsonb("output_json"),
    durationMs: integer("duration_ms"),
    createdAt: createdAt(),
  },
  (table) => ({
    execIdIdx: index("idx_execution_traces_execution_id").on(table.executionId, table.createdAt),
    criticalIdx: index("idx_execution_traces_critical").on(
      table.executionId,
      table.isCritical,
      table.createdAt,
    ),
  }),
);

export type ExecutionTrace = typeof executionTraces.$inferSelect;
export type NewExecutionTrace = typeof executionTraces.$inferInsert;
