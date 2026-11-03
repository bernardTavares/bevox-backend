/**
 * Schema de buffer windows — PRD §11.2. Tenant = organization_id UUID
 * (ADR-021). channel_connection_id FK→channel_connections (Marco 2 C).
 */

import { sql } from "drizzle-orm";
import { integer, index, pgTable, text, timestamp } from "drizzle-orm/pg-core";

import { channelConnections } from "./channels.js";
import { conversations } from "./conversations.js";
import { organizations } from "./tenancy.js";
import { createdAt, organizationIdFk, uuidFk, uuidv7PrimaryKey } from "./_shared.js";

export const bufferWindows = pgTable(
  "buffer_windows",
  {
    id: uuidv7PrimaryKey(),
    organizationId: organizationIdFk()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    // Renomeado de `inbox_id` — `inboxes` não é entidade canon; o ponteiro
    // per-canal é ChannelConnection (§8.3). Coluna nova de A (sem dados).
    channelConnectionId: uuidFk("channel_connection_id").references(() => channelConnections.id, {
      onDelete: "set null",
    }),
    conversationId: uuidFk("conversation_id").references(() => conversations.id, {
      onDelete: "cascade",
    }),
    conversationKey: text("conversation_key").notNull(),
    windowSequence: integer("window_sequence").notNull().default(1),
    state: text("state").notNull().default("open"),
    openedAt: createdAt(),
    cutoffAt: timestamp("cutoff_at", { withTimezone: true, mode: "date" }),
    closedAt: timestamp("closed_at", { withTimezone: true, mode: "date" }),
    messageCount: integer("message_count").notNull().default(0),
    latestExecutionId: uuidFk("latest_execution_id"),
    latestExecutionStatus: text("latest_execution_status"),
  },
  (table) => ({
    openCutoffIdx: index("idx_buffer_windows_open_cutoff")
      .on(table.cutoffAt)
      .where(sql`state = 'open'`),
  }),
);

export type BufferWindow = typeof bufferWindows.$inferSelect;
export type NewBufferWindow = typeof bufferWindows.$inferInsert;
