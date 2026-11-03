/**
 * Ledger de ações manuais de operador staff (B4 — Módulo 17).
 * UUIDv7 PK, tenant = organization_id (ADR-021), FK `buffer_window_id`. Lido pelo detalhe /staff/executions/:id.
 */
import { index, jsonb, pgTable, text } from "drizzle-orm/pg-core";

import { executions } from "./executions.js";
import { bufferWindows } from "./buffer_windows.js";
import { organizations } from "./tenancy.js";
import { createdAt, organizationIdFk, uuidFk, uuidv7PrimaryKey } from "./_shared.js";

export const staffManualActions = pgTable(
  "staff_manual_actions",
  {
    id: uuidv7PrimaryKey(),
    organizationId: organizationIdFk()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    executionId: uuidFk("execution_id").references(() => executions.id, {
      onDelete: "set null",
    }),
    bufferWindowId: uuidFk("buffer_window_id").references(() => bufferWindows.id, {
      onDelete: "set null",
    }),
    actionType: text("action_type").notNull(),
    reason: text("reason").notNull(),
    actorStaffId: text("actor_staff_id").notNull(),
    requestPayloadJson: jsonb("request_payload_json"),
    resultSnapshotJson: jsonb("result_snapshot_json"),
    createdAt: createdAt(),
  },
  (table) => ({
    staffManualActionsExecIdx: index("staff_manual_actions_execution_created_idx").on(
      table.executionId,
      table.createdAt,
    ),
  }),
);

export type StaffManualAction = typeof staffManualActions.$inferSelect;
export type NewStaffManualAction = typeof staffManualActions.$inferInsert;
