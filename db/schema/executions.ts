/**
 * Schema de execução de pipeline IA — PRD §11.2.
 *
 * DDL reproduzido VERBATIM de PRD §11.2, substituindo APENAS o
 * identificador de tenant para `organization_id` (ADR-021).
 *
 * `conversation_id` (NOT NULL) e `buffer_window_id` referenciam
 * `conversations`/`buffer_windows` — FKs ativadas no Marco 2 sub-projeto A
 * (tabelas criadas; migration `0001`). Eram deferidas no Marco-1.
 */

import { sql } from "drizzle-orm";
import { check, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

import { bufferWindows } from "./buffer_windows.js";
import { conversations } from "./conversations.js";
import { organizations } from "./tenancy.js";
import { createdAt, organizationIdFk, updatedAt, uuidFk, uuidv7PrimaryKey } from "./_shared.js";

export const executions = pgTable(
  "executions",
  {
    id: uuidv7PrimaryKey(),
    organizationId: organizationIdFk()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    conversationId: uuidFk("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    bufferWindowId: uuidFk("buffer_window_id").references(() => bufferWindows.id, {
      onDelete: "set null",
    }),
    executionMode: text("execution_mode").notNull(),
    status: text("status").notNull(),
    // SHA-256 do token (PRD §11.2).
    executionTokenHash: text("execution_token_hash").notNull(),
    processingEndpointUrl: text("processing_endpoint_url").notNull(),
    processingTimeoutMs: integer("processing_timeout_ms").notNull(),
    dispatchedAt: timestamp("dispatched_at", { withTimezone: true, mode: "date" }),
    // Dispatch-contract amendment (PRD §10.4 / ADR-019 Amendment 1, aceito
    // 2026-06-03): replay lineage ROOT. NULL on a normal dispatch; on a staff
    // replay it carries the original (root) execution id, chained as
    // `row.original_execution_id ?? row.id`, so the harness idempotency-key
    // dedups external mutations across replays. Plain nullable uuid (no FK —
    // value is always a valid execution id by construction; mirrors the
    // deferred-FK precedent in this schema).
    originalExecutionId: uuidFk("original_execution_id"),
    timeoutAt: timestamp("timeout_at", { withTimezone: true, mode: "date" }),
    completedAt: timestamp("completed_at", { withTimezone: true, mode: "date" }),
    // { dispatch: {...}, result: {...} } (PRD §11.2).
    resultPayload: jsonb("result_payload"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => ({
    // PRD §11.2 CHECKs reproduzidos verbatim.
    executionModeCk: check(
      "executions_execution_mode_check",
      sql`${table.executionMode} IN ('manual_assisted','copilot','autonomous_supervised')`,
    ),
    statusCk: check(
      "executions_status_check",
      sql`${table.status} IN ('pending','dispatching','processing','waiting_input','completing','waiting_approval','done','error','timeout','cancelled','dead_letter','rejected','expired')`,
    ),
    // PRD §11.2 partial UNIQUE index idx_executions_token_hash.
    tokenHashUniq: uniqueIndex("idx_executions_token_hash")
      .on(table.executionTokenHash)
      .where(sql`status NOT IN ('done','error','cancelled','dead_letter')`),
  }),
);

export type Execution = typeof executions.$inferSelect;
export type NewExecution = typeof executions.$inferInsert;
