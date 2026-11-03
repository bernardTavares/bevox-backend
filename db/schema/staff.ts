/**
 * Schema de staff Bevox — PRD §11.2 ("Tabela separada staff_accounts")
 * + rbac-staff-architect. ADR-013: roles EXATAMENTE
 * `bevox_admin | bevox_support | bevox_observer` (prefixadas).
 *
 * Staff Bevox NÃO é uma organization. `staff_impersonations.organization_id`
 * é o alvo de uma sessão de impersonation (ADR-021) — SEM FK aqui
 * (cross-cutting, auditável; o vínculo lógico é a organization-alvo).
 */

import { boolean, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { uuidv7 } from "@/shared/uuid.js";

import { impersonationCategoryEnum, staffRoleEnum } from "./_shared.js";

export const staffAccounts = pgTable("staff_accounts", {
  id: uuid("id").primaryKey().$defaultFn(uuidv7),
  email: text("email").notNull().unique(),
  full_name: text("full_name").notNull(),
  password_hash: text("password_hash").notNull(),
  role: staffRoleEnum("role").notNull(),
  mfa_secret: text("mfa_secret").notNull(),
  active: boolean("active").notNull().default(true),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  last_login_at: timestamp("last_login_at", { withTimezone: true }),
});

export const staffImpersonations = pgTable("staff_impersonations", {
  id: uuid("id").primaryKey().$defaultFn(uuidv7),
  staff_id: uuid("staff_id")
    .references(() => staffAccounts.id)
    .notNull(),
  organization_id: uuid("organization_id").notNull(),
  reason: text("reason").notNull(),
  category: impersonationCategoryEnum("category").notNull(),
  started_at: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  ended_at: timestamp("ended_at", { withTimezone: true }),
  approved_by: uuid("approved_by").references(() => staffAccounts.id),
});

export const staffRefreshTokens = pgTable("staff_refresh_tokens", {
  id: uuid("id").primaryKey().$defaultFn(uuidv7),
  staff_id: uuid("staff_id")
    .references(() => staffAccounts.id)
    .notNull(),
  token_sha256: text("token_sha256").notNull().unique(),
  expires_at: timestamp("expires_at", { withTimezone: true }).notNull(),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type StaffAccount = typeof staffAccounts.$inferSelect;
export type NewStaffAccount = typeof staffAccounts.$inferInsert;
export type StaffImpersonation = typeof staffImpersonations.$inferSelect;
export type NewStaffImpersonation = typeof staffImpersonations.$inferInsert;
export type StaffRefreshToken = typeof staffRefreshTokens.$inferSelect;
export type NewStaffRefreshToken = typeof staffRefreshTokens.$inferInsert;
