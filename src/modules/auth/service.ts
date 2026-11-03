/**
 * Service layer — auth de staff Bevox (ADR-013).
 *
 * Reusa EXCLUSIVAMENTE os helpers de cripto exportados por
 * `@/plugins/staff-auth.js` (HS256 access, refresh UUID-SHA256, bcrypt).
 * Zero re-implementação de cripto aqui.
 *
 * Roles canônicas EXATAMENTE `bevox_admin | bevox_support | bevox_observer`.
 * Tenant = `organization_id` / `organizations` (ADR-021), nunca o lexicon
 * de tenant legado (proibido neste schema).
 */

import { errors } from "@/shared/errors.js";
import {
  generateStaffRefreshToken,
  hashStaffRefreshToken,
  signStaffAccessToken,
  staffRefreshTtlSeconds,
  verifyStaffPassword,
  type StaffRole,
} from "@/plugins/staff-auth.js";

import {
  deleteRefreshToken,
  endImpersonation,
  findActiveImpersonation,
  findActiveStaffByEmail,
  findValidRefreshToken,
  getStaffAuthSecretsById,
  insertAuditEvent,
  insertImpersonation,
  insertRefreshToken,
  organizationExists,
  touchLastLogin,
} from "./repository.js";

export interface SessionTokens {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

async function issueSession(input: {
  staffId: string;
  role: StaffRole;
  impersonationId?: string;
}): Promise<SessionTokens> {
  const access_token = await signStaffAccessToken({
    staff_id: input.staffId,
    role: input.role,
    impersonation_id: input.impersonationId,
  });
  const { token: refresh_token, hash } = generateStaffRefreshToken();
  const ttl = staffRefreshTtlSeconds();
  await insertRefreshToken({
    staffId: input.staffId,
    tokenSha256: hash,
    expiresAtSeconds: ttl,
  });
  return { access_token, refresh_token, expires_in: ttl };
}

/** POST /api/v1/staff/sessions — login por email+senha. */
export async function loginStaff(input: {
  email: string;
  password: string;
}): Promise<SessionTokens> {
  const staff = await findActiveStaffByEmail(input.email);
  if (!staff) {
    throw errors.unauthenticated("Invalid credentials");
  }
  // Secrets DB-direct (LGPD: NÃO cacheado para limitar blast radius de
  // Redis dump/replica leak — ver M5-P1 spec §11 LGPD acceptance).
  const secrets = await getStaffAuthSecretsById(staff.id);
  if (!secrets) {
    // Race: staff foi desativado entre o findActive (cache stale possível)
    // e o secrets fetch (DB autoritativo). Fail-closed.
    throw errors.unauthenticated("Invalid credentials");
  }
  const ok = await verifyStaffPassword(input.password, secrets.password_hash);
  if (!ok) {
    throw errors.unauthenticated("Invalid credentials");
  }
  // MFA: o seam de verificação TOTP existe (staff_accounts.mfa_secret),
  // mas NÃO é enforced no Marco-1.
  // TODO(Marco 3, ADR-013 §MFA): enforce TOTP para bevox_admin usando
  // `secrets.mfa_secret` (que continua DB-direct — NÃO cacheado).
  await touchLastLogin(staff.id);
  return issueSession({ staffId: staff.id, role: staff.role });
}

/** POST /api/v1/staff/sessions/refresh — rotação de refresh. */
export async function refreshStaffSession(input: { refreshToken: string }): Promise<SessionTokens> {
  const hash = hashStaffRefreshToken(input.refreshToken);
  const row = await findValidRefreshToken(hash);
  if (!row) {
    throw errors.unauthenticated("Invalid or expired refresh token");
  }
  // Rotação: invalida o antigo ANTES de emitir o novo.
  await deleteRefreshToken(row.id);
  return issueSession({ staffId: row.staff_id, role: row.role });
}

/** POST /api/v1/staff/impersonation/:organization_id/start */
export async function startImpersonation(input: {
  staffId: string;
  staffRole: StaffRole;
  organizationId: string;
  reason: string;
  category: "support" | "audit" | "incident";
}): Promise<{ impersonation_id: string; access_token: string }> {
  const exists = await organizationExists(input.organizationId);
  if (!exists) {
    throw errors.notFound("Organization", input.organizationId);
  }
  const impersonationId = await insertImpersonation({
    staffId: input.staffId,
    organizationId: input.organizationId,
    reason: input.reason,
    category: input.category,
  });

  // AuditEvent OBRIGATÓRIO (ADR-013 + PRD §12.8) — staff_id + impersonation_id.
  await insertAuditEvent({
    organizationId: input.organizationId,
    entityType: "organization",
    entityId: input.organizationId,
    action: "impersonation.start",
    actorType: "system",
    actorId: input.staffId,
    reasonText: input.reason,
    afterJson: { impersonation_id: impersonationId, category: input.category },
  });

  const access_token = await signStaffAccessToken({
    staff_id: input.staffId,
    role: input.staffRole,
    impersonation_id: impersonationId,
  });
  return { impersonation_id: impersonationId, access_token };
}

/** POST /api/v1/staff/impersonation/:organization_id/end */
export async function endImpersonationSession(input: {
  staffId: string;
  organizationId: string;
  impersonationId: string;
}): Promise<{ ok: true }> {
  const active = await findActiveImpersonation(input.impersonationId);
  if (!active || active.organization_id !== input.organizationId) {
    throw errors.notFound("Active impersonation", input.impersonationId);
  }
  await endImpersonation(input.impersonationId);
  await insertAuditEvent({
    organizationId: input.organizationId,
    entityType: "organization",
    entityId: input.organizationId,
    action: "impersonation.end",
    actorType: "system",
    actorId: input.staffId,
    afterJson: { impersonation_id: input.impersonationId },
  });
  return { ok: true };
}

/**
 * Hook de auditoria: TODA ação de staff sob impersonation emite um
 * audit_event com actor_id=staff_id + after_json.impersonation_id
 * (ADR-013 + PRD §12.8; LGPD-DSR visível). Idempotente por request
 * (chamado uma vez no onResponse das rotas de staff).
 */
export async function auditImpersonatedAction(input: {
  staffId: string;
  impersonationId: string;
  method: string;
  route: string;
}): Promise<void> {
  const active = await findActiveImpersonation(input.impersonationId);
  // organization_id do audit = a organization-alvo da impersonation
  // (audit_events.organization_id é NOT NULL + FK). Se a impersonation
  // já encerrou, não há alvo válido → skip silencioso (a ação de "end"
  // já gerou seu próprio audit_event).
  if (!active) return;
  await insertAuditEvent({
    organizationId: active.organization_id,
    entityType: "staff_action",
    entityId: null,
    action: `staff.${input.method}`,
    actorType: "system",
    actorId: input.staffId,
    afterJson: {
      impersonation_id: input.impersonationId,
      route: input.route,
      method: input.method,
    },
  });
}
