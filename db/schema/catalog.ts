/**
 * Schema de catálogo — PRD §11 (Modelo de Dados §6).
 *
 * Professional, Service, ProfessionalService, ServicePolicy. Toda tabela
 * é tenant-scoped por `organization_id` (ADR-021). Relação
 * professional ↔ user via `professionals.user_id` (ADR SEV-H-07).
 */

import {
  boolean,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { users } from "./identity.js";
import { organizations } from "./tenancy.js";
import {
  createdAt,
  organizationIdFk,
  professionalRoleTypeEnum,
  updatedAt,
  uuidFk,
  uuidv7PrimaryKey,
} from "./_shared.js";

export const professionals = pgTable("professionals", {
  id: uuidv7PrimaryKey(),
  organizationId: organizationIdFk()
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  email: text("email"),
  phone: text("phone"),
  roleType: professionalRoleTypeEnum("role_type").notNull(),
  // ADR SEV-H-07: vínculo opcional a um user.
  userId: uuidFk("user_id").references(() => users.id, { onDelete: "set null" }),
  bio: text("bio"),
  isBookable: boolean("is_bookable").notNull().default(true),
  canTakeHandoffs: boolean("can_take_handoffs").notNull().default(false),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const services = pgTable("services", {
  id: uuidv7PrimaryKey(),
  organizationId: organizationIdFk()
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  category: text("category"),
  description: text("description"),
  durationMinutes: integer("duration_minutes").notNull(),
  priceAmount: numeric("price_amount", { precision: 10, scale: 2 }),
  currency: text("currency").notNull(),
  maxConcurrent: integer("max_concurrent").notNull().default(1),
  bufferBeforeMinutes: integer("buffer_before_minutes"),
  bufferAfterMinutes: integer("buffer_after_minutes"),
  allowWaitlist: boolean("allow_waitlist").notNull().default(false),
  allowFitIn: boolean("allow_fit_in").notNull().default(false),
  maxFitInsPerSlot: integer("max_fit_ins_per_slot"),
  requiresPrepayment: boolean("requires_prepayment").notNull().default(false),
  requiresHumanApproval: boolean("requires_human_approval").notNull().default(false),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const professionalServices = pgTable(
  "professional_services",
  {
    id: uuidv7PrimaryKey(),
    organizationId: organizationIdFk()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    professionalId: uuidFk("professional_id")
      .notNull()
      .references(() => professionals.id, { onDelete: "cascade" }),
    serviceId: uuidFk("service_id")
      .notNull()
      .references(() => services.id, { onDelete: "cascade" }),
    customDurationMinutes: integer("custom_duration_minutes"),
    customPriceAmount: numeric("custom_price_amount", { precision: 10, scale: 2 }),
    isPrimary: boolean("is_primary").notNull().default(false),
    createdAt: createdAt(),
  },
  (table) => ({
    orgProfServiceUniq: uniqueIndex("professional_services_org_prof_service_uniq").on(
      table.organizationId,
      table.professionalId,
      table.serviceId,
    ),
  }),
);

export const servicePolicies = pgTable("service_policies", {
  // 1:1 com services — service_id é a própria PK e FK.
  serviceId: uuid("service_id")
    .primaryKey()
    .references(() => services.id, { onDelete: "cascade" }),
  bookingNoticeMinutes: integer("booking_notice_minutes"),
  rescheduleNoticeMinutes: integer("reschedule_notice_minutes"),
  cancelNoticeMinutes: integer("cancel_notice_minutes"),
  lateToleranceMinutes: integer("late_tolerance_minutes"),
  fitInPolicyJson: jsonb("fit_in_policy_json"),
  waitlistPolicyJson: jsonb("waitlist_policy_json"),
  paymentPolicyJson: jsonb("payment_policy_json"),
  handoffPolicyJson: jsonb("handoff_policy_json"),
  updatedAt: updatedAt(),
});

export type Professional = typeof professionals.$inferSelect;
export type NewProfessional = typeof professionals.$inferInsert;
export type Service = typeof services.$inferSelect;
export type NewService = typeof services.$inferInsert;
export type ProfessionalService = typeof professionalServices.$inferSelect;
export type NewProfessionalService = typeof professionalServices.$inferInsert;
export type ServicePolicy = typeof servicePolicies.$inferSelect;
export type NewServicePolicy = typeof servicePolicies.$inferInsert;
