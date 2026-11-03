/**
 * Teste de integração — DSR export endpoint (PRD §12.9, LGPD).
 *
 * Cobre o POC do gap `no-dsr-export-endpoint`:
 *   (i)   unauthenticated (sem test-seam header) → 401;
 *   (ii)  authenticated em outra org → 404 (customer não existe para o
 *         principal — boundary-by-not-found, sem leak);
 *   (iii) happy path → 200 com shape canônico
 *         { schema_version, generated_at, organization_id, customer, facts,
 *           messages: [], audit_events: [] };
 *   (iv)  customer com facts → facts hidratados no payload.
 *
 * Sobe Postgres (pg_uuidv7 empacotado) + Redis via testcontainers, aplica
 * migrations e exercita o módulo HTTP real via `app.inject`. Mirror do
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

let orgA: string;
let orgB: string;
let customerA: string;
let customerAWithFacts: string;

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

async function seedFact(
  org: string,
  customerId: string,
  key: string,
  value: string,
): Promise<string> {
  const { uuidv7 } = await import("@/shared/uuid.js");
  const id = uuidv7();
  await pool.query(
    `INSERT INTO customer_facts
       (id, organization_id, customer_id, fact_key, fact_value, source_type)
     VALUES ($1,$2,$3,$4,$5,'manual')`,
    [id, org, customerId, key, value],
  );
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

  orgA = await seedOrg("Org DSR A");
  orgB = await seedOrg("Org DSR B");
  customerA = await seedCustomer(orgA, "Maria DSR");
  customerAWithFacts = await seedCustomer(orgA, "João DSR");
  await seedFact(orgA, customerAWithFacts, "allergy", "penicilina");
  await seedFact(orgA, customerAWithFacts, "preferred_time", "tarde");
}, 180_000);

afterAll(async () => {
  await app?.close();
  const { closeDb } = await import("@/db/client.js");
  await closeDb();
  await pool?.end();
  await pgContainer?.stop();
  await redisContainer?.stop();
});

describe("DSR export — GET /api/v1/customers/:id/export (PRD §12.9)", () => {
  it("unauthenticated request → 401 (UNAUTHENTICATED)", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/customers/${customerA}/export`,
    });
    expect(res.statusCode).toBe(401);
    expect((res.json() as { error: { code: string } }).error.code).toBe("UNAUTHENTICATED");
  });

  it("authenticated as org B requesting org A customer → 404 (NOT_FOUND, no cross-org leak)", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/customers/${customerA}/export`,
      headers: authHeaders(orgB),
    });
    expect(res.statusCode).toBe(404);
    expect((res.json() as { error: { code: string } }).error.code).toBe("NOT_FOUND");
  });

  it("happy path → 200 with canonical export shape", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/customers/${customerA}/export`,
      headers: authHeaders(orgA),
    });
    expect(res.statusCode, res.body).toBe(200);

    const body = res.json() as {
      schema_version: string;
      generated_at: string;
      organization_id: string;
      customer: { id: string; organization_id: string; full_name: string };
      facts: unknown[];
      messages: unknown[];
      audit_events: unknown[];
    };

    expect(body.schema_version).toBe("1.0.0-poc");
    expect(typeof body.generated_at).toBe("string");
    expect(() => new Date(body.generated_at).toISOString()).not.toThrow();
    expect(body.organization_id).toBe(orgA);
    expect(body.customer.id).toBe(customerA);
    expect(body.customer.organization_id).toBe(orgA);
    expect(body.customer.full_name).toBe("Maria DSR");
    expect(Array.isArray(body.facts)).toBe(true);
    expect(body.facts).toEqual([]);
    // POC: messages e audit_events são placeholders Marco-3.
    expect(body.messages).toEqual([]);
    expect(body.audit_events).toEqual([]);
  });

  it("customer with facts → facts hydrated in payload", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/customers/${customerAWithFacts}/export`,
      headers: authHeaders(orgA),
    });
    expect(res.statusCode, res.body).toBe(200);

    const body = res.json() as {
      facts: Array<{ fact_key: string; fact_value: string; organization_id: string }>;
    };
    expect(body.facts.length).toBe(2);
    const keys = body.facts.map((f) => f.fact_key).sort();
    expect(keys).toEqual(["allergy", "preferred_time"]);
    for (const f of body.facts) {
      expect(f.organization_id).toBe(orgA);
    }
  });
});
