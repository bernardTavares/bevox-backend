/**
 * Building blocks compartilhados entre schemas Drizzle do bevox-backend.
 *
 * Espelha o STYLE de bevox-meta-api `db/schema/_shared.ts` (column helpers
 * + pgEnum), com o ÚNICO ajuste de import obrigatório (R2 da Task 2):
 * a fonte de UUIDv7 é `@/shared/uuid.js` (não `@/lib/uuid.js`; o backend
 * tem uma única SoT hand-rolled em `src/shared/uuid.ts`).
 *
 * Convenções (PRD §7.3 + Modelo de Dados):
 *  - IDs: UUIDv7 (ADR-001) em todas as PKs. App gera (não o Postgres);
 *    no SQL gerado o default é `gen_uuid_v7()` (ver nota de extensões).
 *  - Timestamps: `timestamptz` UTC com default `now()`.
 *  - Soft-delete: `deleted_at` nullable (nunca DELETE físico).
 *  - Enums: pgEnum quando o valor é parte do contrato; text quando livre.
 *  - Tenant identity (ADR-021 canônico): coluna `organization_id`,
 *    tabela `organizations`. NUNCA o lexicon de tenant legado no schema novo.
 *
 * Extensões Postgres necessárias (PRD §11.4) — a migration DEVE rodar,
 * antes do DDL das tabelas:
 *   CREATE EXTENSION IF NOT EXISTS pg_uuidv7;   -- gen_uuid_v7()
 *   CREATE EXTENSION IF NOT EXISTS "uuid-ossp"; -- legacy compat
 *   CREATE EXTENSION IF NOT EXISTS pg_trgm;     -- fuzzy text search (FAQ)
 * e os IDs usam o default `gen_uuid_v7()` (PRD §11.2/§11.4). O default da
 * PK é setado via `.$defaultFn(uuidv7)` (app-side) e o SQL default
 * `gen_uuid_v7()` é garantido pela migration custom de extensões.
 */

import { sql } from "drizzle-orm";
import { pgEnum, timestamp, uuid } from "drizzle-orm/pg-core";

import { uuidv7 } from "@/shared/uuid.js";

// ---------------------------------------------------------------------------
// Enums — espelham PRD §11.2 / Modelo de Dados estritamente.
// NÃO renomear sem ADR superseding.
// ---------------------------------------------------------------------------

// PRD §11.2 verbatim (resolve SEV-M-01).
export const onboardingStageEnum = pgEnum("onboarding_stage_enum", [
  "welcome",
  "business_profile",
  "professionals",
  "services",
  "schedule",
  "calendar_sync",
  "channels",
  "payments",
  "knowledge",
  "manual_assisted",
  "copilot_active",
]);

// AISuggestion / AutonomyProfile — modo de execução (ADR-006).
export const aiModeEnum = pgEnum("ai_mode", [
  "manual_assisted",
  "copilot",
  "autonomous_supervised",
]);

export const organizationStatusEnum = pgEnum("organization_status", [
  "active",
  "suspended",
  "disabled",
  "deleted",
]);

export const userRoleEnum = pgEnum("user_role", [
  "owner",
  "admin",
  "operator",
  "professional_viewer",
]);

export const userStatusEnum = pgEnum("user_status", ["active", "invited", "disabled"]);

export const professionalRoleTypeEnum = pgEnum("professional_role_type", [
  "provider",
  "operator",
  "provider_operator",
]);

export const customerStatusEnum = pgEnum("customer_status", ["active", "archived", "blocked"]);

export const auditActorTypeEnum = pgEnum("audit_actor_type", ["user", "ai", "system", "webhook"]);

export const staffRoleEnum = pgEnum("staff_role", [
  "bevox_admin",
  "bevox_support",
  "bevox_observer",
]);

export const impersonationCategoryEnum = pgEnum("impersonation_category", [
  "support",
  "audit",
  "incident",
]);

// ---------------------------------------------------------------------------
// Column helpers — usados em todas as tabelas.
// ---------------------------------------------------------------------------

/**
 * PK UUIDv7 gerada pela aplicação (ADR-001 / R1: SoT = src/shared/uuid.ts).
 * Drizzle armazena como `uuid` nativo no Postgres; aplicação envia string v7.
 * No SQL gerado o DEFAULT é reforçado para `gen_uuid_v7()` pela migration
 * de extensões (PRD §11.2).
 */
export const uuidv7PrimaryKey = () =>
  uuid("id")
    .primaryKey()
    .$defaultFn(() => uuidv7());

/**
 * FK para outra tabela usando uuid (sem default — quem cria fornece).
 */
export const uuidFk = (name: string) => uuid(name);

/**
 * Coluna de tenant canônica (ADR-021): `organization_id uuid NOT NULL`.
 * O `.references(() => organizations.id, ...)` é aplicado na tabela
 * (evita ciclo de import neste módulo base).
 */
export const organizationIdFk = () => uuid("organization_id");

/**
 * `created_at` timestamptz UTC com default now(). Imutável após insert.
 */
export const createdAt = () =>
  timestamp("created_at", { withTimezone: true, mode: "date" })
    .notNull()
    .default(sql`now()`);

/**
 * `updated_at` timestamptz UTC com default now(). Atualizar via service layer.
 */
export const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true, mode: "date" })
    .notNull()
    .default(sql`now()`);

/**
 * `deleted_at` nullable — soft-delete. NULL = ativo.
 */
export const deletedAt = () => timestamp("deleted_at", { withTimezone: true, mode: "date" });
