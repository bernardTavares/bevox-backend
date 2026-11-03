/**
 * Teste de integração — rotas REST do Manual Payment Mode (M5-P4 Task 11).
 *
 * Cobre a CAMADA DE ROTA (thin wrapper) das 5 rotas manuais via `app.inject`,
 * complementando payments-manual-mode.test.ts (que exercita o service real).
 * Foco do route layer: wiring de preHandler (auth/org-scope), parse de params,
 * delegação ao service e shape de resposta. A lógica de ledger/idempotência já
 * é coberta no nível de service.
 *
 *   (i)   unauthenticated (sem o test-seam header) → 401 em uma rota manual;
 *   (ii)  connect-manual → 201 com payment_account.id + onboarding_status;
 *         create-manual (happy path) → 201 com charge_id + status pending;
 *   (iii) create-manual com body inválido (amount_total ausente) → 400.
 *
 * Sobe Postgres (pg_uuidv7 empacotado) + Redis via testcontainers, aplica
 * migrations e exercita o módulo HTTP real. Auth Clerk via test-seam header
 * `x-test-clerk-organization` — honrado APENAS quando a feature flag
 * explícita `TEST_AUTH_BYPASS_ENABLED=true` está setada (defense-in-depth
 * post-finding `test-seam-auth-bypass-on-nodeenv-test`); este beforeAll
 * seta a flag. O seam fixa clerk_user_id='test_clerk_user'. Mirror do
 * lifecycle de container de organizations-crud.test.ts.
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

let orgId: string;
let customerId: string;

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

async function seedCustomer(org: string, fullName: string): Promise<string> {
  const { uuidv7 } = await import("@/shared/uuid.js");
  const id = uuidv7();
  await pool.query(`INSERT INTO customers (id, organization_id, full_name) VALUES ($1,$2,$3)`, [
    id,
    org,
    fullName,
  ]);
  return id;
}

function authHeaders(org: string): Record<string, string> {
  return { "x-test-clerk-organization": org };
}

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

  orgId = await seedOrg("Org Manual Routes");
  customerId = await seedCustomer(orgId, "Cliente Manual");
}, 180_000);

afterAll(async () => {
  await app?.close();
  const { closeDb } = await import("@/db/client.js");
  await closeDb();
  await pool?.end();
  await pgContainer?.stop();
  await redisContainer?.stop();
});

describe("manual payment mode REST routes", () => {
  it("unauthenticated request → 401 (requireClerkAuth)", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/organizations/${orgId}/payment-account/connect-manual`,
    });
    expect(res.statusCode).toBe(401);
    expect((res.json() as { error: { code: string } }).error.code).toBe("UNAUTHENTICATED");
  });

  it("POST connect-manual → 201 with payment_account; then create-manual → 201 pending", async () => {
    const connect = await app.inject({
      method: "POST",
      url: `/api/v1/organizations/${orgId}/payment-account/connect-manual`,
      headers: authHeaders(orgId),
    });
    expect(connect.statusCode, connect.body).toBe(201);
    const acct = connect.json() as {
      payment_account: { id: string; onboarding_status: string };
    };
    expect(acct.payment_account.id).toBeTruthy();
    expect(acct.payment_account.onboarding_status).toBe("active");

    const create = await app.inject({
      method: "POST",
      url: `/api/v1/organizations/${orgId}/charges/manual`,
      headers: { ...authHeaders(orgId), "idempotency-key": `manual-charge-${Date.now()}` },
      payload: {
        customer_id: customerId,
        amount_total: 150.0,
        charge_type: "full",
        payment_method: "cash",
      },
    });
    expect(create.statusCode, create.body).toBe(201);
    const body = create.json() as { charge_id: string; status: string };
    expect(body.charge_id).toBeTruthy();
    expect(body.status).toBe("pending");

    const row = await pool.query<{ status: string; provider_charge_id: string | null }>(
      `SELECT status, provider_charge_id FROM charges WHERE id = $1`,
      [body.charge_id],
    );
    expect(row.rows[0]!.status).toBe("pending");
    expect(row.rows[0]!.provider_charge_id).toBeNull();
  });

  it("POST create-manual with invalid body (no amount_total) → 400", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/organizations/${orgId}/charges/manual`,
      headers: { ...authHeaders(orgId), "idempotency-key": `manual-bad-${Date.now()}` },
      payload: { customer_id: customerId, charge_type: "full" },
    });
    expect(res.statusCode, res.body).toBe(400);
    expect((res.json() as { error: { code: string } }).error.code).toBe("INVALID_INPUT");
  });
});
