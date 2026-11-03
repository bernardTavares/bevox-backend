/**
 * Teste de integração — rotas REST do policy setter (M5-P3a).
 * Mirror do lifecycle de container de payments-manual-routes.test.ts.
 * Auth Clerk via test-seam header `x-test-clerk-organization` (NODE_ENV=test);
 * o seam fixa clerk_user_id='test_clerk_user'.
 */
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

let pgContainer: StartedTestContainer;
let redisContainer: StartedTestContainer;
let pool: pg.Pool;
let app: FastifyInstance;

let orgWithAccount: string;
let orgNoAccount: string;

async function seedOrg(name: string): Promise<string> {
  const { uuidv7 } = await import("@/shared/uuid.js");
  const id = uuidv7();
  await pool.query(
    `INSERT INTO organizations
       (id, name, business_name, niche, timezone, currency, locale)
     VALUES ($1,$2,$2,'clinica','America/Sao_Paulo','BRL','pt-BR')`,
    [id, name],
  );
  await pool.query(`INSERT INTO organization_settings (organization_id) VALUES ($1)`, [id]);
  return id;
}

function authHeaders(org: string): Record<string, string> {
  return { "x-test-clerk-organization": org };
}

beforeAll(async () => {
  pgContainer = await new GenericContainer(PG_IMAGE)
    .withEnvironment({ POSTGRES_DB: PG_DB, POSTGRES_USER: PG_USER, POSTGRES_PASSWORD: PG_PASSWORD })
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

  process.env.NODE_ENV = "test";
  // Explicit opt-in to the test-seam header injection (finding
  // test-seam-auth-bypass-on-nodeenv-test). Without this flag, the
  // `x-test-clerk-organization` header is ignored and requests would
  // fail 401. Defense-in-depth: env schema rejects this in production.
  process.env.TEST_AUTH_BYPASS_ENABLED = "true";
  process.env.DATABASE_URL = dbUrl;
  process.env.REDIS_URL = redisUrl;
  process.env.STAFF_JWT_SECRET = "test-staff-jwt-secret-please-rotate-in-prod";

  pool = new pg.Pool({ connectionString: dbUrl, max: 4 });
  await migrate(drizzle(pool), { migrationsFolder: "./db/migrations" });

  const { buildServer } = await import("@/bootstrap/server.js");
  const { initDb } = await import("@/db/client.js");
  await initDb();
  app = await buildServer();
  await app.ready();

  orgWithAccount = await seedOrg("Org Policy With Account");
  orgNoAccount = await seedOrg("Org Policy No Account");
}, 180_000);

afterAll(async () => {
  await app?.close();
  const { closeDb } = await import("@/db/client.js");
  await closeDb();
  await pool?.end();
  await pgContainer?.stop();
  await redisContainer?.stop();
});

describe("GET payment-account/policy (M5-P3a)", () => {
  it("unauthenticated → 401", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/organizations/${orgNoAccount}/payment-account/policy`,
    });
    expect(res.statusCode).toBe(401);
  });

  it("org sem payment_account → 200 com defaults canon", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/organizations/${orgNoAccount}/payment-account/policy`,
      headers: authHeaders(orgNoAccount),
    });
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json() as {
      policy: { no_show_consumes_session: boolean; platform_fee_percent: number };
    };
    expect(body.policy.no_show_consumes_session).toBe(false);
    expect(body.policy.platform_fee_percent).toBe(0);
  });

  it("reflete o split_config_json existente (fee 7, no_show true)", async () => {
    await app.inject({
      method: "POST",
      url: `/api/v1/organizations/${orgWithAccount}/payment-account/connect-manual`,
      headers: authHeaders(orgWithAccount),
    });
    await pool.query(
      `UPDATE payment_accounts
         SET split_config_json = '{"platform_fee_percent": 7, "no_show_consumes_session": true}'::jsonb
       WHERE organization_id = $1 AND account_holder_type = 'organization'`,
      [orgWithAccount],
    );
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/organizations/${orgWithAccount}/payment-account/policy`,
      headers: authHeaders(orgWithAccount),
    });
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json() as {
      policy: { no_show_consumes_session: boolean; platform_fee_percent: number };
    };
    expect(body.policy.no_show_consumes_session).toBe(true);
    expect(body.policy.platform_fee_percent).toBe(7);
  });

  it("override explícito false/0 é preservado (ADR-018 ### 4 fail-closed)", async () => {
    await pool.query(
      `UPDATE payment_accounts
         SET split_config_json = '{"platform_fee_percent": 0, "no_show_consumes_session": false}'::jsonb
       WHERE organization_id = $1 AND account_holder_type = 'organization'`,
      [orgWithAccount],
    );
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/organizations/${orgWithAccount}/payment-account/policy`,
      headers: authHeaders(orgWithAccount),
    });
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json() as {
      policy: { no_show_consumes_session: boolean; platform_fee_percent: number };
    };
    expect(body.policy.no_show_consumes_session).toBe(false);
    expect(body.policy.platform_fee_percent).toBe(0);
  });
});

describe("PATCH payment-account/policy (M5-P3a)", () => {
  it("org sem payment_account → 404", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/api/v1/organizations/${orgNoAccount}/payment-account/policy`,
      headers: authHeaders(orgNoAccount),
      payload: { no_show_consumes_session: true },
    });
    expect(res.statusCode, res.body).toBe(404);
    expect((res.json() as { error: { code: string } }).error.code).toBe("NOT_FOUND");
  });

  it("MERGE preserva platform_fee_percent; seta no_show; audita; GET reflete", async () => {
    // orgWithAccount já tem conta (GET block). Reset o split p/ só a fee, p/ provar
    // que o PATCH adiciona no_show sem clobber.
    await pool.query(
      `UPDATE payment_accounts SET split_config_json = '{"platform_fee_percent": 7}'::jsonb
         WHERE organization_id = $1 AND account_holder_type = 'organization'`,
      [orgWithAccount],
    );
    const res = await app.inject({
      method: "PATCH",
      url: `/api/v1/organizations/${orgWithAccount}/payment-account/policy`,
      headers: authHeaders(orgWithAccount),
      payload: { no_show_consumes_session: true },
    });
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json() as {
      policy: { no_show_consumes_session: boolean; platform_fee_percent: number };
    };
    expect(body.policy.no_show_consumes_session).toBe(true);
    expect(body.policy.platform_fee_percent).toBe(7); // fee INTOCADA

    const row = await pool.query<{
      split: { platform_fee_percent: number; no_show_consumes_session: boolean };
    }>(
      `SELECT split_config_json AS split FROM payment_accounts
         WHERE organization_id = $1 AND account_holder_type = 'organization'`,
      [orgWithAccount],
    );
    expect(row.rows[0]!.split.platform_fee_percent).toBe(7);
    expect(row.rows[0]!.split.no_show_consumes_session).toBe(true);

    // Audit row gravada com before/after + actor_clerk_user_id.
    // INVARIANTE deste arquivo: este é o ÚNICO PATCH bem-sucedido em orgWithAccount
    // (os outros casos PATCH são 400/404 → não gravam audit). Se um futuro teste
    // adicionar outro PATCH-200 em orgWithAccount, ajuste o toBe(1) ou use outra org.
    const audit = await pool.query<{
      action: string;
      actor_id: string | null;
      after_json: {
        patch: unknown;
        actor_clerk_user_id: string;
        after: { platform_fee_percent: number; no_show_consumes_session: boolean };
      };
    }>(
      `SELECT action, actor_id, after_json FROM audit_events
         WHERE organization_id = $1 AND entity_type = 'payment_account'
           AND action = 'payment_account.policy_updated'`,
      [orgWithAccount],
    );
    expect(audit.rows.length).toBe(1);
    expect(audit.rows[0]!.after_json.actor_clerk_user_id).toBe("test_clerk_user");
    expect(audit.rows[0]!.actor_id).toBeNull();
    expect(audit.rows[0]!.after_json.after.platform_fee_percent).toBe(7);
    expect(audit.rows[0]!.after_json.after.no_show_consumes_session).toBe(true);

    // Paridade de shape PATCH↔GET: GET pós-PATCH devolve o mesmo policy
    const get = await app.inject({
      method: "GET",
      url: `/api/v1/organizations/${orgWithAccount}/payment-account/policy`,
      headers: authHeaders(orgWithAccount),
    });
    expect((get.json() as { policy: unknown }).policy).toEqual(body.policy);
  });

  it("rejeita platform_fee_percent no body → 400", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/api/v1/organizations/${orgWithAccount}/payment-account/policy`,
      headers: authHeaders(orgWithAccount),
      payload: { platform_fee_percent: 0 },
    });
    expect(res.statusCode, res.body).toBe(400);
    expect((res.json() as { error: { code: string } }).error.code).toBe("INVALID_INPUT");
  });

  it("rejeita patch vazio → 400", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/api/v1/organizations/${orgWithAccount}/payment-account/policy`,
      headers: authHeaders(orgWithAccount),
      payload: {},
    });
    expect(res.statusCode, res.body).toBe(400);
  });
});
