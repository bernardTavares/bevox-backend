/**
 * Schema de tenancy — PRD §11 (Modelo de Dados §5).
 *
 * `organizations` é a unidade de isolamento de cliente Bevox (workspace
 * tenant; identificador canônico `organization_id` per ADR-021). Staff
 * Bevox NÃO é uma organization (ver `staff.ts`).
 */

import { boolean, integer, jsonb, pgTable, text, uuid } from "drizzle-orm/pg-core";

import {
  aiModeEnum,
  createdAt,
  onboardingStageEnum,
  organizationStatusEnum,
  updatedAt,
  uuidv7PrimaryKey,
} from "./_shared.js";

export const organizations = pgTable("organizations", {
  id: uuidv7PrimaryKey(),
  name: text("name").notNull(),
  businessName: text("business_name").notNull(),
  legalName: text("legal_name"),
  niche: text("niche").notNull(),
  timezone: text("timezone").notNull(),
  currency: text("currency").notNull(),
  locale: text("locale").notNull(),
  onboardingStage: onboardingStageEnum("onboarding_stage").notNull().default("welcome"),
  aiMode: aiModeEnum("ai_mode").notNull().default("manual_assisted"),
  status: organizationStatusEnum("status").notNull().default("active"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const organizationSettings = pgTable("organization_settings", {
  // 1:1 com organizations — organization_id é a própria PK e FK.
  organizationId: uuid("organization_id")
    .primaryKey()
    .references(() => organizations.id, { onDelete: "cascade" }),
  defaultReplyTone: text("default_reply_tone"),
  defaultLanguage: text("default_language"),
  allowSameDayBooking: boolean("allow_same_day_booking").notNull().default(true),
  defaultBookingNoticeMinutes: integer("default_booking_notice_minutes"),
  defaultCancelNoticeMinutes: integer("default_cancel_notice_minutes"),
  defaultRescheduleNoticeMinutes: integer("default_reschedule_notice_minutes"),
  reminderPolicyJson: jsonb("reminder_policy_json"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export type Organization = typeof organizations.$inferSelect;
export type NewOrganization = typeof organizations.$inferInsert;
export type OrganizationSettings = typeof organizationSettings.$inferSelect;
export type NewOrganizationSettings = typeof organizationSettings.$inferInsert;
