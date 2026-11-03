/**
 * Schema de conexões de canal — Modelo de Dados Produto §8.3
 * (ChannelConnection). Tenant = organization_id (ADR-021). NÃO há
 * entidade `inboxes` no canon — config por-canal vive em
 * `routing_config_json` (§8.3). §8.2 CustomerChannel já entregue pelo
 * sub-projeto A em `db/schema/customers.ts` (não recriar aqui).
 */

import { sql } from "drizzle-orm";
import { check, jsonb, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";

import { organizations } from "./tenancy.js";
import { createdAt, organizationIdFk, updatedAt, uuidv7PrimaryKey } from "./_shared.js";

export const channelConnections = pgTable(
  "channel_connections",
  {
    id: uuidv7PrimaryKey(),
    organizationId: organizationIdFk()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    externalAccountId: text("external_account_id").notNull(),
    displayName: text("display_name"),
    status: text("status").notNull().default("pending"),
    routingConfigJson: jsonb("routing_config_json").notNull().default({}),
    operatingHoursJson: jsonb("operating_hours_json"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => ({
    statusCk: check(
      "channel_connections_status_check",
      sql`${table.status} IN ('pending','connected','error','revoked')`,
    ),
    orgProviderAccountUniq: uniqueIndex(
      "channel_connections_org_provider_external_account_uniq",
    ).on(table.organizationId, table.provider, table.externalAccountId),
  }),
);

export type ChannelConnection = typeof channelConnections.$inferSelect;
export type NewChannelConnection = typeof channelConnections.$inferInsert;
