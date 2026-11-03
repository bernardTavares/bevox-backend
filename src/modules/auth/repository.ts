/**
 * Repository do módulo auth (staff Bevox) — ADR-013.
 *
 * R3 (Task 2/3, architecture-reviewer): `src/` não pode ter import de VALOR
 * de `@db/schema` (puxaria `db/` para fora do `rootDir:./src` e quebraria o
 * `dist/index.js` plano — TS6059). Como `src/lib/health.ts`, este módulo
 * usa o query-builder cru `getDb().execute(sql\`...\`)` com SQL
 * parametrizado (sem `${var}` interpolado em texto livre).
 *
 * Toda query de staff/impersonation/audit é parametrizada — zero
 * concatenação de input do usuário.
 */

import { sql } from "drizzle-orm";

import { getDb } from "@/db/client.js";
import { cacheAside } from "@/lib/cache.js";

const STAFF_CACHE_NAMESPACE = "staff-account-by-email";
const STAFF_CACHE_TTL_SECONDS = 300;

/**
 * Metadata cacheada — SEM secrets.
 *
 * LGPD M5-P1 fix (lgpd-officer SEV-C + SEV-H): `password_hash` e
 * `mfa_secret` foram retirados deste shape para limitar blast radius de
 * Redis dump/replica leak. Secrets ficam DB-direct via
 * `getStaffAuthSecretsById`.
 *
 * Ver M5-P1 spec §11 LGPD acceptance + ADR-019 item 11.
 */
export interface StaffAccountMetadataRow {
  id: string;
  email: string;
  full_name: string;
  role: "bevox_admin" | "bevox_support" | "bevox_observer";
  active: boolean;
}

/**
 * Secrets — DB-direct, NÃO cacheado (LGPD requirement).
 *
 * `password_hash` + `mfa_secret` (TOTP seed) NUNCA atravessam Redis.
 * Login flow paga 1 query extra ao DB — auth-rare, custo negligible.
 */
export interface StaffAuthSecretsRow {
  password_hash: string;
  mfa_secret: string;
}

export async function findActiveStaffByEmail(
  email: string,
): Promise<StaffAccountMetadataRow | null> {
  return (await cacheAside(email, {
    namespace: STAFF_CACHE_NAMESPACE,
    ttlSeconds: STAFF_CACHE_TTL_SECONDS,
    fetch: async () => {
      const res = await getDb().execute(
        sql`SELECT id, email, full_name, role, active
              FROM staff_accounts
             WHERE email = ${email} AND active = true
             LIMIT 1`,
      );
      return (res.rows[0] as StaffAccountMetadataRow | undefined) ?? null;
    },
  })) as StaffAccountMetadataRow | null;
}

/**
 * Secrets fetch DB-direct (NÃO usa cacheAside).
 *
 * LGPD: TOTP seed + bcrypt hash nunca entram em Redis. Usado pelo login
 * flow após resolver metadata via `findActiveStaffByEmail`. Se retornar
 * `null`, o staff foi desativado entre os calls (cache pode estar stale)
 * → caller deve fail-closed.
 */
export async function getStaffAuthSecretsById(
  staffId: string,
): Promise<StaffAuthSecretsRow | null> {
  const res = await getDb().execute(
    sql`SELECT password_hash, mfa_secret
          FROM staff_accounts
         WHERE id = ${staffId} AND active = true
         LIMIT 1`,
  );
  return (res.rows[0] as StaffAuthSecretsRow | undefined) ?? null;
}

/**
 * NOTE: `last_login_at` NÃO está no SELECT shape de findActiveStaffByEmail
 * (id, email, full_name, role, active — pós LGPD M5-P1 fix) →
 * touchLastLogin NÃO precisa invalidar cache.
 *
 * FUTURO: qualquer UPDATE/DELETE que toque (full_name | role | active)
 * DEVE chamar `cacheInvalidate(STAFF_CACHE_NAMESPACE, email)` paired.
 * `password_hash` / `mfa_secret` NÃO entram nessa lista — não são
 * cacheados (DB-direct via getStaffAuthSecretsById).
 *
 * Hard-delete worker (canon ADR-020, ainda não landed em main) é o
 * caller out-of-scope V1 — ver M5-P1 spec §11 LGPD acceptance criterion.
 */
export async function touchLastLogin(staffId: string): Promise<void> {
  await getDb().execute(sql`UPDATE staff_accounts SET last_login_at = now() WHERE id = ${staffId}`);
}

export async function insertRefreshToken(input: {
  staffId: string;
  tokenSha256: string;
  expiresAtSeconds: number;
}): Promise<void> {
  await getDb().execute(
    sql`INSERT INTO staff_refresh_tokens (staff_id, token_sha256, expires_at)
        VALUES (${input.staffId}, ${input.tokenSha256},
                now() + (${input.expiresAtSeconds} || ' seconds')::interval)`,
  );
}

export interface RefreshTokenRow {
  id: string;
  staff_id: string;
  role: "bevox_admin" | "bevox_support" | "bevox_observer";
}

/** Refresh válido = existe + não expirado. Junta com o staff p/ role. */
export async function findValidRefreshToken(tokenSha256: string): Promise<RefreshTokenRow | null> {
  const res = await getDb().execute(
    sql`SELECT rt.id, rt.staff_id, sa.role
          FROM staff_refresh_tokens rt
          JOIN staff_accounts sa ON sa.id = rt.staff_id
         WHERE rt.token_sha256 = ${tokenSha256}
           AND rt.expires_at > now()
           AND sa.active = true
         LIMIT 1`,
  );
  return (res.rows[0] as RefreshTokenRow | undefined) ?? null;
}

export async function deleteRefreshToken(id: string): Promise<void> {
  await getDb().execute(sql`DELETE FROM staff_refresh_tokens WHERE id = ${id}`);
}

export async function organizationExists(orgId: string): Promise<boolean> {
  const res = await getDb().execute(sql`SELECT 1 FROM organizations WHERE id = ${orgId} LIMIT 1`);
  return res.rows.length > 0;
}

export async function insertImpersonation(input: {
  staffId: string;
  organizationId: string;
  reason: string;
  category: "support" | "audit" | "incident";
}): Promise<string> {
  const res = await getDb().execute(
    sql`INSERT INTO staff_impersonations
          (staff_id, organization_id, reason, category)
        VALUES (${input.staffId}, ${input.organizationId},
                ${input.reason}, ${input.category})
        RETURNING id`,
  );
  return (res.rows[0] as { id: string }).id;
}

export interface ActiveImpersonationRow {
  id: string;
  staff_id: string;
  organization_id: string;
}

export async function findActiveImpersonation(
  impersonationId: string,
): Promise<ActiveImpersonationRow | null> {
  const res = await getDb().execute(
    sql`SELECT id, staff_id, organization_id
          FROM staff_impersonations
         WHERE id = ${impersonationId} AND ended_at IS NULL
         LIMIT 1`,
  );
  return (res.rows[0] as ActiveImpersonationRow | undefined) ?? null;
}

export async function endImpersonation(impersonationId: string): Promise<void> {
  await getDb().execute(
    sql`UPDATE staff_impersonations
           SET ended_at = now()
         WHERE id = ${impersonationId} AND ended_at IS NULL`,
  );
}

/**
 * Insere um audit_event. `audit_events.organization_id` é NOT NULL + FK
 * para organizations (ver db/schema/audit.ts) — o alvo é sempre a
 * organization da impersonation/ação.
 */
export async function insertAuditEvent(input: {
  organizationId: string;
  entityType: string;
  entityId: string | null;
  action: string;
  actorType: "user" | "ai" | "system" | "webhook";
  actorId: string | null;
  reasonText?: string | null;
  afterJson?: Record<string, unknown> | null;
}): Promise<void> {
  await getDb().execute(
    sql`INSERT INTO audit_events
          (organization_id, entity_type, entity_id, action,
           actor_type, actor_id, reason_text, after_json)
        VALUES (${input.organizationId}, ${input.entityType},
                ${input.entityId}, ${input.action}, ${input.actorType},
                ${input.actorId}, ${input.reasonText ?? null},
                ${input.afterJson ? JSON.stringify(input.afterJson) : null}::jsonb)`,
  );
}

// ----- Clerk webhook user-sync (ADR-013) -----

export async function findOrganizationByClerkOrg(clerkOrgId: string): Promise<string | null> {
  // Marco-1: o vínculo Clerk org → organization é resolvido via users já
  // sincronizados (não há tabela de mapping dedicada ainda). Se não houver
  // organization resolvível, o sync de user é no-op idempotente.
  const res = await getDb().execute(
    sql`SELECT organization_id FROM users
         WHERE clerk_user_id = ${clerkOrgId} LIMIT 1`,
  );
  const row = res.rows[0] as { organization_id: string } | undefined;
  return row?.organization_id ?? null;
}

export async function upsertUserFromClerk(input: {
  clerkUserId: string;
  organizationId: string;
  name: string;
  email: string | null;
}): Promise<void> {
  await getDb().execute(
    sql`INSERT INTO users (organization_id, name, email, role, clerk_user_id)
        VALUES (${input.organizationId}, ${input.name}, ${input.email},
                'operator', ${input.clerkUserId})
        ON CONFLICT (clerk_user_id)
        DO UPDATE SET name = EXCLUDED.name, email = EXCLUDED.email`,
  );
}

export async function deleteUserByClerkId(clerkUserId: string): Promise<void> {
  await getDb().execute(sql`DELETE FROM users WHERE clerk_user_id = ${clerkUserId}`);
}

/**
 * Local user row resolved from a Clerk principal claim.
 *
 * Read by the `clerk-auth` plugin after a successful JWT verify to
 * populate `req.user` with local domain context (org-scoped uuid + role).
 * Returns null when no local row has been provisioned yet for the given
 * `clerk_user_id` (e.g. webhook lag, or token issued for a user that is
 * not provisioned in this backend). Callers must treat null as
 * "Clerk-authenticated, but not yet linked to a local user".
 *
 * `req.auth` (JWT claims) remains the canonical principal envelope —
 * this seam is purely additive metadata for future RBAC enforcement.
 * The follow-up PR will (a) sanitize `role` against the postgres
 * `user_role` enum and (b) wire `requireRole(roles)` middleware that
 * consumes `req.user.role`.
 *
 * `users.id` is `uuid` (`gen_uuid_v7()` default). `role` is the postgres
 * enum `user_role` (`owner|admin|operator|professional_viewer`). The
 * lookup is keyed exclusively by the unique index
 * `users_clerk_user_id_uniq` on `users(clerk_user_id)` — no org scoping
 * here because the claim trust boundary is the JWT itself; the local
 * row carries the canonical `organization_id` back to the caller.
 */
export interface LocalUserRow {
  id: string;
  organization_id: string;
  role: "owner" | "admin" | "operator" | "professional_viewer";
  email: string | null;
  name: string;
}

export async function findUserByClerkUserId(clerkUserId: string): Promise<LocalUserRow | null> {
  const res = await getDb().execute(
    sql`SELECT id, organization_id, role, email, name
          FROM users
         WHERE clerk_user_id = ${clerkUserId}
         LIMIT 1`,
  );
  return (res.rows[0] as LocalUserRow | undefined) ?? null;
}
