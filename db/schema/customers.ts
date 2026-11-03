/**
 * Schema de cliente-final — PRD §11 (Modelo de Dados §8) + §11.2 ajustes.
 *
 * `customers` é o cliente-do-cliente Bevox. `customer_facts` é a entidade
 * nova da ADR-002 — DDL reproduzido VERBATIM de PRD §11.2, substituindo
 * APENAS o identificador de tenant para `organization_id` (ADR-021).
 */

import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { executions } from "./executions.js";
import { organizations } from "./tenancy.js";
import {
  createdAt,
  customerStatusEnum,
  deletedAt,
  organizationIdFk,
  updatedAt,
  uuidFk,
  uuidv7PrimaryKey,
} from "./_shared.js";

export const customers = pgTable("customers", {
  id: uuidv7PrimaryKey(),
  organizationId: organizationIdFk()
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  fullName: text("full_name").notNull(),
  preferredName: text("preferred_name"),
  primaryPhone: text("primary_phone"),
  primaryEmail: text("primary_email"),
  notesInternal: text("notes_internal"),
  riskFlagsJson: jsonb("risk_flags_json"),
  // PRD §11.2: absorve preferred_language / preferred_contact_channel /
  // preferred_time_from/to (ADR-005).
  preferencesJson: jsonb("preferences_json"),
  consentGrantedAt: timestamp("consent_granted_at", { withTimezone: true, mode: "date" }),
  aiOptOut: boolean("ai_opt_out").notNull().default(false),
  archivedAt: timestamp("archived_at", { withTimezone: true, mode: "date" }),
  deletedAt: deletedAt(),
  status: customerStatusEnum("status").notNull().default("active"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const customerChannels = pgTable(
  "customer_channels",
  {
    id: uuidv7PrimaryKey(),
    organizationId: organizationIdFk()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    customerId: uuidFk("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    externalUserId: text("external_user_id").notNull(),
    displayName: text("display_name"),
    phoneNumber: text("phone_number"),
    handle: text("handle"),
    isPrimary: boolean("is_primary").notNull().default(false),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true, mode: "date" }),
    createdAt: createdAt(),
  },
  (table) => ({
    // PRD §11.3: UNIQUE (organization_id, provider, external_user_id).
    orgProviderExternalUniq: uniqueIndex("customer_channels_org_provider_external_uniq").on(
      table.organizationId,
      table.provider,
      table.externalUserId,
    ),
  }),
);

/**
 * customer_facts — PRD §11.2 DDL VERBATIM (ADR-002), tenant col
 * `organization_id` (ADR-021). Espelha 1:1:
 *   id UUID PK DEFAULT gen_uuid_v7()
 *   organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE
 *   customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE
 *   fact_key TEXT NOT NULL
 *   fact_value TEXT NOT NULL
 *   category TEXT
 *   confidence NUMERIC(4,3) CHECK (confidence >= 0 AND confidence <= 1)
 *   source_type TEXT NOT NULL CHECK (source_type IN ('ai_extracted','manual','imported'))
 *   source_execution_id UUID            -- FK a executions quando ai_extracted
 *   superseded_by UUID REFERENCES customer_facts(id)
 *   is_private BOOLEAN NOT NULL DEFAULT FALSE
 *   created_at TIMESTAMPTZ NOT NULL DEFAULT now()
 *   updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
 * + CREATE INDEX idx_customer_facts_active ON customer_facts
 *   (organization_id, customer_id) WHERE superseded_by IS NULL
 */
export const customerFacts = pgTable(
  "customer_facts",
  {
    id: uuidv7PrimaryKey(),
    organizationId: organizationIdFk()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    customerId: uuidFk("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    factKey: text("fact_key").notNull(),
    factValue: text("fact_value").notNull(),
    category: text("category"),
    confidence: numeric("confidence", { precision: 4, scale: 3 }),
    sourceType: text("source_type").notNull(),
    // FK a executions quando ai_extracted (PRD §11.2).
    sourceExecutionId: uuidFk("source_execution_id").references(() => executions.id, {
      onDelete: "set null",
    }),
    supersededBy: uuidFk("superseded_by"),
    isPrivate: boolean("is_private").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => ({
    // PRD §11.2 CHECKs reproduzidos verbatim.
    confidenceRangeCk: check(
      "customer_facts_confidence_range",
      sql`${table.confidence} >= 0 AND ${table.confidence} <= 1`,
    ),
    sourceTypeCk: check(
      "customer_facts_source_type_check",
      sql`${table.sourceType} IN ('ai_extracted','manual','imported')`,
    ),
    // self-ref FK customer_facts.superseded_by -> customer_facts.id
    supersededByFk: foreignKey({
      columns: [table.supersededBy],
      foreignColumns: [table.id],
      name: "customer_facts_superseded_by_fkey",
    }),
    // PRD §11.2 partial index idx_customer_facts_active.
    activeIdx: index("idx_customer_facts_active")
      .on(table.organizationId, table.customerId)
      .where(sql`superseded_by IS NULL`),
  }),
);

export type Customer = typeof customers.$inferSelect;
export type NewCustomer = typeof customers.$inferInsert;
export type CustomerChannel = typeof customerChannels.$inferSelect;
export type NewCustomerChannel = typeof customerChannels.$inferInsert;
export type CustomerFact = typeof customerFacts.$inferSelect;
export type NewCustomerFact = typeof customerFacts.$inferInsert;
