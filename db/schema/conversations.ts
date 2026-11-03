/**
 * Schema de Conversa — Modelo de Dados Produto §9.1 (domínio) + tabela de
 * estado de pipeline (mecânica de orquestração).
 *
 * `conversations` = entidade canônica de domínio §9.1. Os campos de
 * orquestração (dedup/lease/concurrency) vivem em
 * `conversation_pipeline_state` (1:1; guard `active_execution_id`+`version`
 * é per-conversa). Tenant = `organization_id` (ADR-021). FKs a tabelas de
 * Marcos posteriores são DEFERIDAS (sem `.references()`), precedente
 * Marco-1 `executions.ts`.
 */

import { sql } from "drizzle-orm";
import { check, index, numeric, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

import { channelConnections } from "./channels.js";
import { customerChannels, customers } from "./customers.js";
import { organizations } from "./tenancy.js";
import { createdAt, organizationIdFk, updatedAt, uuidFk, uuidv7PrimaryKey } from "./_shared.js";

export const conversations = pgTable(
  "conversations",
  {
    id: uuidv7PrimaryKey(),
    organizationId: organizationIdFk()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    customerId: uuidFk("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    channelConnectionId: uuidFk("channel_connection_id").references(() => channelConnections.id, {
      onDelete: "set null",
    }),
    customerChannelId: uuidFk("customer_channel_id").references(() => customerChannels.id, {
      onDelete: "set null",
    }),
    status: text("status").notNull(),
    currentOwnerType: text("current_owner_type").notNull(),
    // user/professional atual — polimórfico, sem FK (Modelo §9.1).
    currentOwnerId: uuidFk("current_owner_id"),
    lastIntent: text("last_intent"),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true, mode: "date" }),
    // FK→appointments (Marco 3) — deferida.
    linkedAppointmentId: uuidFk("linked_appointment_id"),
    priorityScore: numeric("priority_score"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => ({
    statusCk: check(
      "conversations_status_check",
      sql`${table.status} IN ('open','waiting_human','waiting_customer','closed')`,
    ),
    ownerTypeCk: check(
      "conversations_current_owner_type_check",
      sql`${table.currentOwnerType} IN ('ai','user','queue')`,
    ),
    orgStatusIdx: index("conversations_org_status_idx").on(table.organizationId, table.status),
    orgLastMsgIdx: index("conversations_org_last_message_at_idx").on(
      table.organizationId,
      table.lastMessageAt,
    ),
  }),
);

export const conversationPipelineState = pgTable(
  "conversation_pipeline_state",
  {
    id: uuidv7PrimaryKey(),
    organizationId: organizationIdFk()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    conversationId: uuidFk("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    conversationKey: text("conversation_key").notNull(),
    externalConversationId: text("external_conversation_id"),
    channelAccountId: text("channel_account_id"),
    // DEPRECATED (M3-P3 + M4-P3 SEV-L; M5-P2a annotation): nenhum write
    // path popula essa column em main 7251d52. Output protocol payload
    // para harness usa channelConnectionId (line 31 — FK vivo) com fallback
    // para conversation_id em src/modules/orchestration/cutoff.ts:67.
    // Drop em M6+ quando harness organization_id native (canon ADR-021)
    // + 4 protocol callers migrated (harness-dispatch.schema.ts,
    // harness-dispatcher.ts, orchestration/cutoff.ts, staff-ops/actions.repository.ts).
    // Vocabulário de pipeline (≠ status de domínio §9.1).
    pipelineStatus: text("pipeline_status"),
    // Guard de execução-única per-conversa (atravessa buffer_windows).
    activeExecutionId: uuidFk("active_execution_id"),
    version: text("version").notNull().default("1"),
    leaseOwner: text("lease_owner"),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true, mode: "date" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => ({
    convKeyUniq: uniqueIndex("conversation_pipeline_state_conversation_key_uniq").on(
      table.conversationKey,
    ),
    convIdUniq: uniqueIndex("conversation_pipeline_state_conversation_id_uniq").on(
      table.conversationId,
    ),
  }),
);

export type Conversation = typeof conversations.$inferSelect;
export type NewConversation = typeof conversations.$inferInsert;
export type ConversationPipelineState = typeof conversationPipelineState.$inferSelect;
export type NewConversationPipelineState = typeof conversationPipelineState.$inferInsert;
