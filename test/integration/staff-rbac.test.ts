/**
 * Teste de integração — staff RBAC + impersonation audit (Task 5).
 *
 * Entrega o work-item canônico `backend-staff-rbac` (governed_by ADR-013):
 *   - sessões staff HS256 (access 900s) + refresh UUID SHA-256 (7d, rotativo);
 *   - RBAC `requireStaff` sobre roles `bevox_admin|bevox_support|bevox_observer`;
 *   - impersonation com AuditEvent obrigatório (staff_id + impersonation_id);
 *   - toda ação de staff sob impersonation emite AuditEvent (ADR-013 + PRD §12.8).
 *
 * Sobe Postgres 16 (pg_uuidv7 empacotado) + Redis via testcontainers — portas
 * efêmeras próprias, NÃO depende do compose local. Aplica as migrations e
 * exercita o módulo HTTP real via `app.inject`.
 *
 * Executa: pnpm test:integration test/integration/staff-rbac.test.ts (Docker).
 */

import { createHash } from "node:crypto";

import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { GenericContainer, type StartedTestContainer, Wait } from "testcontainers";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { FastifyInstance } from "fastify";

const PG_IMAGE = "ghcr.io/fboulnois/pg_uuidv7:1.6.0";
const PG_DB = "bevox_backend_test";
const PG_USER = "bevox";
const PG_PASSWORD = "bevox_test_password";

const REDIS_IMAGE = "redis:7-alpine";

const STAFF_SECRET = "test-staff-jwt-secret-please-rotate-in-prod";

let pgContainer: StartedTestContainer;
let redisContainer: StartedTestContainer;
let pool: pg.Pool;
// Importados dinamicamente DEPOIS de setar env (env() é singleton lazy).
let app: FastifyInstance;

function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

const ADMIN_EMAIL = "admin@bevox.test";
const SUPPORT_EMAIL = "support@bevox.test";
const OBSERVER_EMAIL = "observer@bevox.test";
const PASSWORD = "correct horse battery staple";

let orgId: string;

beforeAll(async () => {
  pgContainer = await new GenericContainer(PG_IMAGE)
    .withEnvironment({
      POSTGRES_DB: PG_DB,
      POSTGRES_USER: PG_USER,
      POSTGRES_PASSWORD: PG_PASSWORD,
    })
    .withExposedPorts(5432)
    .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))
    .withStartupTimeout(90_000)
    .start();

  redisContainer = await new GenericContainer(REDIS_IMAGE)
    .withExposedPorts(6379)
    .withWaitStrategy(Wait.forLogMessage(/Ready to accept connections/))
    .withStartupTimeout(60_000)
    .start();

  const dbUrl = `postgresql://${PG_USER}:${PG_PASSWORD}@${pgContainer.getHost()}:${pgContainer.getMappedPort(
    5432,
  )}/${PG_DB}`;
  const redisUrl = `redis://${redisContainer.getHost()}:${redisContainer.getMappedPort(6379)}`;

  // env() é singleton lazy validado por Zod — setar ANTES de qualquer import
  // que toque config/db. NODE_ENV=test pula o dotenv (ver config/env.ts).
  process.env.NODE_ENV = "test";
  process.env.TEST_AUTH_BYPASS_ENABLED = "true";
  process.env.DATABASE_URL = dbUrl;
  process.env.REDIS_URL = redisUrl;
  process.env.STAFF_JWT_SECRET = STAFF_SECRET;
  process.env.STAFF_JWT_ACCESS_TTL = "900";
  process.env.STAFF_REFRESH_TTL_DAYS = "7";
  process.env.BCRYPT_COST = "4"; // rápido em teste; produção = 12 (env default)
  process.env.CLERK_WEBHOOK_SECRET = "whsec_dGVzdHNlY3JldHRlc3RzZWNyZXR0ZXN0";

  pool = new pg.Pool({ connectionString: dbUrl, max: 4 });
  const migrationDb = drizzle(pool);
  await migrate(migrationDb, { migrationsFolder: "./db/migrations" });

  // Import dinâmico pós-env.
  const { buildServer } = await import("@/bootstrap/server.js");
  const { initDb } = await import("@/db/client.js");
  await initDb();
  app = await buildServer();
  await app.ready();

  // Seed: organization-alvo + 3 staff (bcrypt hash via helper exportado).
  const { hashStaffPassword } = await import("@/plugins/staff-auth.js");
  const { uuidv7 } = await import("@/shared/uuid.js");
  orgId = uuidv7();
  await pool.query(
    `INSERT INTO organizations
       (id, name, business_name, niche, timezone, currency, locale)
     VALUES ($1,'Org Teste','Org Teste LTDA','clinica','America/Sao_Paulo','BRL','pt-BR')`,
    [orgId],
  );
  const hash = await hashStaffPassword(PASSWORD);
  for (const [email, role] of [
    [ADMIN_EMAIL, "bevox_admin"],
    [SUPPORT_EMAIL, "bevox_support"],
    [OBSERVER_EMAIL, "bevox_observer"],
  ] as const) {
    await pool.query(
      `INSERT INTO staff_accounts
         (id, email, full_name, password_hash, role, mfa_secret, active)
       VALUES ($1,$2,$3,$4,$5,'',true)`,
      [uuidv7(), email, email, hash, role],
    );
  }
}, 180_000);

afterAll(async () => {
  await app?.close();
  const { closeDb } = await import("@/db/client.js");
  await closeDb();
  await pool?.end();
  await pgContainer?.stop();
  await redisContainer?.stop();
});

async function login(email: string): Promise<{ access: string; refresh: string }> {
  const res = await app.inject({
    method: "POST",
    url: "/api/v1/staff/sessions",
    payload: { email, password: PASSWORD },
  });
  expect(res.statusCode, res.body).toBe(200);
  const body = res.json() as { access_token: string; refresh_token: string };
  return { access: body.access_token, refresh: body.refresh_token };
}

function decodeJwt(token: string): {
  header: Record<string, unknown>;
  payload: Record<string, unknown>;
} {
  const [h, p] = token.split(".");
  const header = JSON.parse(Buffer.from(h!, "base64url").toString("utf8"));
  const payload = JSON.parse(Buffer.from(p!, "base64url").toString("utf8"));
  return { header, payload };
}

describe("staff impersonation audit", () => {
  it("POST /api/v1/staff/sessions issues HS256 access(900s)+refresh, bcrypt-verified", async () => {
    const bad = await app.inject({
      method: "POST",
      url: "/api/v1/staff/sessions",
      payload: { email: ADMIN_EMAIL, password: "wrong" },
    });
    expect(bad.statusCode).toBe(401);

    const { access, refresh } = await login(ADMIN_EMAIL);
    const { header, payload } = decodeJwt(access);
    expect(header.alg).toBe("HS256");
    const ttl = (payload.exp as number) - (payload.iat as number);
    expect(ttl).toBe(900);
    expect(payload.role).toBe("bevox_admin");

    // refresh está armazenado como SHA-256, nunca em plaintext.
    const plain = await pool.query(`SELECT 1 FROM staff_refresh_tokens WHERE token_sha256 = $1`, [
      refresh,
    ]);
    expect(plain.rowCount).toBe(0);
    const hashed = await pool.query(`SELECT 1 FROM staff_refresh_tokens WHERE token_sha256 = $1`, [
      sha256(refresh),
    ]);
    expect(hashed.rowCount).toBe(1);
  });

  it("requireStaff enforces bevox_admin|bevox_support|bevox_observer", async () => {
    const observer = await login(OBSERVER_EMAIL);
    const support = await login(SUPPORT_EMAIL);

    // bevox_observer batendo numa rota admin-only (impersonation start) → 403.
    const denied = await app.inject({
      method: "POST",
      url: `/api/v1/staff/impersonation/${orgId}/start`,
      headers: { authorization: `Bearer ${observer.access}` },
      payload: { reason: "x", category: "support" },
    });
    expect(denied.statusCode).toBe(403);

    // bevox_support tem permissão → 200.
    const ok = await app.inject({
      method: "POST",
      url: `/api/v1/staff/impersonation/${orgId}/start`,
      headers: { authorization: `Bearer ${support.access}` },
      payload: { reason: "investigar ticket", category: "support" },
    });
    expect(ok.statusCode, ok.body).toBe(200);
  });

  it("POST /api/v1/staff/impersonation/:organization_id/start writes AuditEvent(staff_id, impersonation_id)", async () => {
    const support = await login(SUPPORT_EMAIL);
    const staffRow = await pool.query<{ id: string }>(
      `SELECT id FROM staff_accounts WHERE email = $1`,
      [SUPPORT_EMAIL],
    );
    const staffId = staffRow.rows[0]!.id;

    const res = await app.inject({
      method: "POST",
      url: `/api/v1/staff/impersonation/${orgId}/start`,
      headers: { authorization: `Bearer ${support.access}` },
      payload: { reason: "suporte ao cliente", category: "support" },
    });
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json() as { impersonation_id: string; access_token: string };
    expect(body.impersonation_id).toBeTruthy();

    const imp = await pool.query(
      `SELECT 1 FROM staff_impersonations WHERE id = $1 AND staff_id = $2 AND organization_id = $3`,
      [body.impersonation_id, staffId, orgId],
    );
    expect(imp.rowCount).toBe(1);

    const audit = await pool.query<{ actor_id: string; after_json: unknown }>(
      `SELECT actor_id, after_json FROM audit_events
        WHERE action LIKE 'impersonation.start%' AND actor_id = $1
        ORDER BY created_at DESC LIMIT 1`,
      [staffId],
    );
    expect(audit.rowCount).toBe(1);
    expect(audit.rows[0]!.actor_id).toBe(staffId);
    expect(JSON.stringify(audit.rows[0]!.after_json)).toContain(body.impersonation_id);
  });

  it("every staff action during impersonation emits an AuditEvent with staff_id+impersonation_id", async () => {
    const support = await login(SUPPORT_EMAIL);
    const start = await app.inject({
      method: "POST",
      url: `/api/v1/staff/impersonation/${orgId}/start`,
      headers: { authorization: `Bearer ${support.access}` },
      payload: { reason: "auditoria", category: "audit" },
    });
    expect(start.statusCode, start.body).toBe(200);
    const { impersonation_id, access_token } = start.json() as {
      impersonation_id: string;
      access_token: string;
    };

    const before = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM audit_events
        WHERE after_json->>'impersonation_id' = $1`,
      [impersonation_id],
    );

    // Qualquer ação de staff sob impersonation → novo audit_event.
    const action = await app.inject({
      method: "POST",
      url: `/api/v1/staff/impersonation/${orgId}/end`,
      headers: { authorization: `Bearer ${access_token}` },
      payload: {},
    });
    expect(action.statusCode, action.body).toBe(200);

    const after = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM audit_events
        WHERE after_json->>'impersonation_id' = $1`,
      [impersonation_id],
    );
    expect(Number(after.rows[0]!.n)).toBeGreaterThan(Number(before.rows[0]!.n));

    const staffRow = await pool.query<{ id: string }>(
      `SELECT id FROM staff_accounts WHERE email = $1`,
      [SUPPORT_EMAIL],
    );
    const tagged = await pool.query(
      `SELECT 1 FROM audit_events
        WHERE after_json->>'impersonation_id' = $1 AND actor_id = $2 LIMIT 1`,
      [impersonation_id, staffRow.rows[0]!.id],
    );
    expect(tagged.rowCount).toBe(1);
  });

  it("refresh token rotates (old SHA-256 invalidated, new issued)", async () => {
    const { refresh } = await login(ADMIN_EMAIL);
    const oldHash = sha256(refresh);

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/staff/sessions/refresh",
      payload: { refresh_token: refresh },
    });
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json() as { access_token: string; refresh_token: string };
    expect(body.access_token).toBeTruthy();
    expect(body.refresh_token).not.toBe(refresh);

    const old = await pool.query(`SELECT 1 FROM staff_refresh_tokens WHERE token_sha256 = $1`, [
      oldHash,
    ]);
    expect(old.rowCount).toBe(0);
    const fresh = await pool.query(`SELECT 1 FROM staff_refresh_tokens WHERE token_sha256 = $1`, [
      sha256(body.refresh_token),
    ]);
    expect(fresh.rowCount).toBe(1);

    // Reuso do refresh antigo agora falha.
    const reuse = await app.inject({
      method: "POST",
      url: "/api/v1/staff/sessions/refresh",
      payload: { refresh_token: refresh },
    });
    expect(reuse.statusCode).toBe(401);
  });
});
