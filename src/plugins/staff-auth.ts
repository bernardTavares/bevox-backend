/**
 * Plugin Fastify — autenticação de staff Bevox (ADR-013).
 *
 * JWT próprio HS256 (chave estática `STAFF_JWT_SECRET`):
 *   - access token TTL = `STAFF_JWT_ACCESS_TTL` (default 900s).
 *   - refresh = UUIDv7 opaco; armazenado como SHA-256 hash; TTL =
 *     `STAFF_REFRESH_TTL_DAYS` (default 7d).
 *   - senha = bcrypt cost `BCRYPT_COST` (default 12).
 *
 * Por que HS256 (não RS256)? Universo de staff é ínfimo, gerenciado
 * internamente; a chave nunca sai do servidor; não há cliente externo
 * que precise assinar localmente.
 *
 * Roles globais de staff = EXATAMENTE `bevox_admin | bevox_support |
 * bevox_observer` (ADR-013, nomes canônicos). Decora `request.staff`.
 * Expõe `app.requireStaff({ roles })` (preHandler).
 *
 * Helpers puros exportados para reuso pela Task 5 (módulo staff RBAC) e
 * testes sem DB viva.
 */

import { createHash, randomUUID } from "node:crypto";

import bcrypt from "bcrypt";
import fp from "fastify-plugin";
import { SignJWT, jwtVerify } from "jose";
import type { FastifyInstance, FastifyPluginAsync, preHandlerHookHandler } from "fastify";

import { env } from "@/config/env.js";
import { errors } from "@/shared/errors.js";
import { uuidv7 } from "@/shared/uuid.js";

export const STAFF_ROLES = ["bevox_admin", "bevox_support", "bevox_observer"] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

const STAFF_AUDIENCE = "bevox-backend-staff";

interface StaffPrincipal {
  staff_id: string;
  role: StaffRole;
  impersonation_id?: string;
}

function isStaffRole(v: unknown): v is StaffRole {
  return typeof v === "string" && (STAFF_ROLES as readonly string[]).includes(v);
}

function staffSecret(): Uint8Array {
  const cfg = env();
  if (!cfg.STAFF_JWT_SECRET) {
    throw errors.internal("STAFF_JWT_SECRET is not configured");
  }
  return new TextEncoder().encode(cfg.STAFF_JWT_SECRET);
}

// ---------------------------------------------------------------------------
// Pure helpers — reused by Task 5 (staff RBAC module) + unit-testable.
// ---------------------------------------------------------------------------

export interface StaffAccessClaims {
  staff_id: string;
  role: StaffRole;
  impersonation_id?: string;
}

/** Assina um access token HS256 com TTL = STAFF_JWT_ACCESS_TTL. */
export async function signStaffAccessToken(claims: StaffAccessClaims): Promise<string> {
  const cfg = env();
  const builder = new SignJWT({ role: claims.role, impersonation_id: claims.impersonation_id })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(claims.staff_id)
    .setAudience(STAFF_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${cfg.STAFF_JWT_ACCESS_TTL}s`);
  return builder.sign(staffSecret());
}

/** Verifica + decodifica um access token HS256. */
export async function verifyStaffAccessToken(token: string): Promise<StaffPrincipal> {
  let payload: Awaited<ReturnType<typeof jwtVerify>>["payload"];
  try {
    const verified = await jwtVerify(token, staffSecret(), {
      algorithms: ["HS256"],
      audience: STAFF_AUDIENCE,
      clockTolerance: "5s",
    });
    payload = verified.payload;
  } catch (err) {
    throw errors.unauthenticated(
      `Staff JWT verification failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (typeof payload.sub !== "string" || payload.sub.length === 0) {
    throw errors.unauthenticated("Missing sub (staff_id) claim");
  }
  if (!isStaffRole(payload.role)) {
    throw errors.unauthenticated("Invalid or missing staff role claim");
  }
  const principal: StaffPrincipal = { staff_id: payload.sub, role: payload.role };
  if (typeof payload.impersonation_id === "string" && payload.impersonation_id.length > 0) {
    principal.impersonation_id = payload.impersonation_id;
  }
  return principal;
}

/** Gera um refresh token opaco (UUIDv7) — devolve o token e seu hash. */
export function generateStaffRefreshToken(): { token: string; hash: string } {
  const token = uuidv7();
  return { token, hash: hashStaffRefreshToken(token) };
}

/** SHA-256 hex do refresh token. Só o hash é persistido. */
export function hashStaffRefreshToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Verificação constante-equivalente: compara hash do candidato com o stored. */
export function verifyStaffRefreshToken(token: string, storedHash: string): boolean {
  return hashStaffRefreshToken(token) === storedHash;
}

/** TTL do refresh token em segundos (STAFF_REFRESH_TTL_DAYS). */
export function staffRefreshTtlSeconds(): number {
  return env().STAFF_REFRESH_TTL_DAYS * 24 * 60 * 60;
}

/** bcrypt hash de senha de staff (cost BCRYPT_COST). */
export async function hashStaffPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, env().BCRYPT_COST);
}

/** Verifica senha de staff contra hash bcrypt. */
export async function verifyStaffPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

/** UUIDv4 sem ser UUIDv7 — usado p/ refresh fallback se chamado fora de DI. */
export function newOpaqueId(): string {
  return randomUUID();
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

const plugin: FastifyPluginAsync = async (app: FastifyInstance) => {
  app.decorateRequest("staff", undefined);

  app.decorate("requireStaff", (opts: { roles?: StaffRole[] } = {}): preHandlerHookHandler => {
    const required = opts.roles ?? [];
    return async (req) => {
      const header = req.headers.authorization;
      if (typeof header !== "string" || !header.startsWith("Bearer ")) {
        throw errors.unauthenticated("Missing Bearer token");
      }
      const token = header.slice("Bearer ".length).trim();
      if (token.length === 0) {
        throw errors.unauthenticated("Empty Bearer token");
      }

      const principal = await verifyStaffAccessToken(token);
      req.staff = principal;

      if (required.length > 0 && !required.includes(principal.role)) {
        throw errors.forbidden("Staff role not permitted for this route", {
          required,
          have: principal.role,
        });
      }
    };
  });
};

export default fp(plugin, {
  name: "staff-auth",
  fastify: "5.x",
});

export { type StaffPrincipal, STAFF_AUDIENCE };
