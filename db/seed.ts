/**
 * Seed de desenvolvimento — dados mínimos para subir o backend localmente.
 *
 * Insere:
 *   - 1 `organizations` (tenant cliente Bevox; identificador canônico
 *     `organization_id` per ADR-021).
 *   - 1 `staff_accounts` role `bevox_admin` (ADR-013) com senha de dev
 *     hasheada via o helper bcrypt de `src/plugins/staff-auth.ts`.
 *   - feriados nacionais BR (M3-C1, Módulo 5 Calendar).
 *
 * Idempotente: usa `onConflictDoNothing` por email/identidade natural.
 * NUNCA usar a senha de dev em produção.
 */

import { eq } from "drizzle-orm";

import { hashStaffPassword } from "@/plugins/staff-auth.js";
import { uuidv7 } from "@/shared/uuid.js";

import type { Database } from "@/db/client.js";
import { systemHolidays } from "./schema/calendar.js";
import { organizations } from "./schema/tenancy.js";
import { staffAccounts } from "./schema/staff.js";

// Feriados nacionais BR 2026 (M3-C1, Módulo 5 Calendar). Recorrentes anuais.
const BR_HOLIDAYS: ReadonlyArray<{ date: string; name: string }> = [
  { date: "2026-01-01", name: "Confraternização Universal" },
  { date: "2026-04-21", name: "Tiradentes" },
  { date: "2026-05-01", name: "Dia do Trabalho" },
  { date: "2026-09-07", name: "Independência do Brasil" },
  { date: "2026-10-12", name: "Nossa Senhora Aparecida" },
  { date: "2026-11-02", name: "Finados" },
  { date: "2026-11-15", name: "Proclamação da República" },
  { date: "2026-12-25", name: "Natal" },
];

export const SEED_ORG_NAME = "Bevox Dev Org";
export const SEED_STAFF_EMAIL = "dev-admin@bevox.local";
// Senha de DEV apenas — sobrescrever via env real em qualquer ambiente.
const SEED_STAFF_DEV_PASSWORD = "bevox-dev-admin-change-me";

export interface SeedResult {
  organizationId: string;
  staffAccountId: string;
}

export async function seed(db: Database): Promise<SeedResult> {
  const organizationId = uuidv7();

  await db
    .insert(organizations)
    .values({
      id: organizationId,
      name: SEED_ORG_NAME,
      businessName: "Bevox Desenvolvimento LTDA",
      legalName: "Bevox Desenvolvimento LTDA",
      niche: "general",
      timezone: "America/Sao_Paulo",
      currency: "BRL",
      locale: "pt-BR",
      onboardingStage: "welcome",
      aiMode: "manual_assisted",
      status: "active",
    })
    .onConflictDoNothing();

  const passwordHash = await hashStaffPassword(SEED_STAFF_DEV_PASSWORD);
  const staffAccountId = uuidv7();

  await db
    .insert(staffAccounts)
    .values({
      id: staffAccountId,
      email: SEED_STAFF_EMAIL,
      full_name: "Bevox Dev Admin",
      password_hash: passwordHash,
      role: "bevox_admin",
      // MFA real é configurado no enrolment; placeholder de dev.
      mfa_secret: "DEVSEEDONLYNOTASECRET",
      active: true,
    })
    .onConflictDoNothing();

  // Feriados BR — idempotente via unique (country_code, date).
  await db
    .insert(systemHolidays)
    .values(
      BR_HOLIDAYS.map((h) => ({
        id: uuidv7(),
        countryCode: "BR",
        date: h.date,
        name: h.name,
        isRecurring: true,
      })),
    )
    .onConflictDoNothing();

  // Resolve os IDs reais (caso já existissem por idempotência).
  const [org] = await db
    .select({ id: organizations.id })
    .from(organizations)
    .where(eq(organizations.name, SEED_ORG_NAME))
    .limit(1);
  const [staff] = await db
    .select({ id: staffAccounts.id })
    .from(staffAccounts)
    .where(eq(staffAccounts.email, SEED_STAFF_EMAIL))
    .limit(1);

  return {
    organizationId: org?.id ?? organizationId,
    staffAccountId: staff?.id ?? staffAccountId,
  };
}
