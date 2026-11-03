/**
 * Teste de integração — client CRUD modules (Task 6, PRD §10.1).
 *
 * Cobre:
 *   - organization GET/PATCH + settings GET/PATCH;
 *   - cross-organization token → 403 (organization-scope guard);
 *   - POST professional idempotente (mesmo Idempotency-Key 2x → 1 linha,
 *     resposta cacheada).
 *
 * Sobe Postgres 16 (pg_uuidv7 empacotado) + Redis via testcontainers,
 * aplica migrations, exercita o módulo HTTP real via `app.inject`.
 * Auth Clerk via test-seam header `x-test-clerk-organization`
 * (honrado APENAS sob NODE_ENV=test).
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

let orgA: string;
let orgB: string;

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

  orgA = await seedOrg("Org A");
  orgB = await seedOrg("Org B");
}, 180_000);

afterAll(async () => {
  await app?.close();
  const { closeDb } = await import("@/db/client.js");
  await closeDb();
  await pool?.end();
  await pgContainer?.stop();
  await redisContainer?.stop();
});

function authHeaders(orgId: string): Record<string, string> {
  return { "x-test-clerk-organization": orgId };
}

describe("organizations CRUD + organization-scope + idempotency", () => {
  it("GET /api/v1/organizations/:id returns the organization", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/organizations/${orgA}`,
      headers: authHeaders(orgA),
    });
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json() as { id: string; name: string };
    expect(body.id).toBe(orgA);
    expect(body.name).toBe("Org A");
  });

  it("PATCH /api/v1/organizations/:id updates the organization", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/api/v1/organizations/${orgA}`,
      headers: { ...authHeaders(orgA), "idempotency-key": `patch-org-${Date.now()}` },
      payload: { name: "Org A Renamed" },
    });
    expect(res.statusCode, res.body).toBe(200);
    expect((res.json() as { name: string }).name).toBe("Org A Renamed");

    const row = await pool.query<{ name: string }>(`SELECT name FROM organizations WHERE id = $1`, [
      orgA,
    ]);
    expect(row.rows[0]!.name).toBe("Org A Renamed");
  });

  it("GET + PATCH /api/v1/organizations/:id/settings round-trips", async () => {
    const patch = await app.inject({
      method: "PATCH",
      url: `/api/v1/organizations/${orgA}/settings`,
      headers: { ...authHeaders(orgA), "idempotency-key": `patch-set-${Date.now()}` },
      payload: { default_reply_tone: "warm", allow_same_day_booking: false },
    });
    expect(patch.statusCode, patch.body).toBe(200);

    const get = await app.inject({
      method: "GET",
      url: `/api/v1/organizations/${orgA}/settings`,
      headers: authHeaders(orgA),
    });
    expect(get.statusCode, get.body).toBe(200);
    const body = get.json() as {
      default_reply_tone: string;
      allow_same_day_booking: boolean;
    };
    expect(body.default_reply_tone).toBe("warm");
    expect(body.allow_same_day_booking).toBe(false);
  });

  it("cross-organization token → 403 (organization-scope guard)", async () => {
    // Principal authenticated as orgB, but path targets orgA.
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/organizations/${orgA}`,
      headers: authHeaders(orgB),
    });
    expect(res.statusCode).toBe(403);
    expect((res.json() as { error: { code: string } }).error.code).toBe("FORBIDDEN");
  });

  it("POST professional is idempotent (same Idempotency-Key → one row, cached response)", async () => {
    const key = `prof-${Date.now()}`;
    const payload = {
      name: "Dra. Ana",
      role_type: "provider",
      email: "ana@orga.test",
    };

    const first = await app.inject({
      method: "POST",
      url: `/api/v1/organizations/${orgA}/professionals`,
      headers: { ...authHeaders(orgA), "idempotency-key": key },
      payload,
    });
    expect(first.statusCode, first.body).toBe(201);
    const firstBody = first.json() as { id: string };
    expect(firstBody.id).toBeTruthy();

    const second = await app.inject({
      method: "POST",
      url: `/api/v1/organizations/${orgA}/professionals`,
      headers: { ...authHeaders(orgA), "idempotency-key": key },
      payload,
    });
    expect(second.statusCode, second.body).toBe(201);
    expect(second.headers["idempotent-replay"]).toBe("true");
    expect((second.json() as { id: string }).id).toBe(firstBody.id);

    const count = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM professionals
        WHERE organization_id = $1 AND name = 'Dra. Ana'`,
      [orgA],
    );
    expect(Number(count.rows[0]!.n)).toBe(1);
  });

  it("GET /api/v1/organizations/:id/professionals lists organization-scoped rows", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/organizations/${orgA}/professionals`,
      headers: authHeaders(orgA),
    });
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json() as { items: Array<{ id: string }> };
    expect(Array.isArray(body.items)).toBe(true);
    expect(body.items.length).toBeGreaterThanOrEqual(1);
  });
});
