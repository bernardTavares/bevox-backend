/**
 * Schema de identidade de cliente — PRD §11 (Modelo de Dados §5).
 *
 * `users` = humanos de uma organization (owner/admin/operator/viewer).
 * Auth cliente-final via Clerk (ADR-013) — `clerk_user_id` único.
 * Staff Bevox vive em `staff.ts` (tabela separada, ADR-013).
 */

import { pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

import { organizations } from "./tenancy.js";
import {
  createdAt,
  organizationIdFk,
  userRoleEnum,
  userStatusEnum,
  uuidv7PrimaryKey,
} from "./_shared.js";

export const users = pgTable(
  "users",
  {
    id: uuidv7PrimaryKey(),
    organizationId: organizationIdFk()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    email: text("email"),
    phone: text("phone"),
    role: userRoleEnum("role").notNull(),
    status: userStatusEnum("status").notNull().default("active"),
    lastActiveAt: timestamp("last_active_at", { withTimezone: true, mode: "date" }),
    // Clerk é a IdP cliente-final (ADR-013). Único globalmente.
    clerkUserId: text("clerk_user_id").notNull(),
    createdAt: createdAt(),
  },
  (table) => ({
    clerkUserIdUniq: uniqueIndex("users_clerk_user_id_uniq").on(table.clerkUserId),
  }),
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
