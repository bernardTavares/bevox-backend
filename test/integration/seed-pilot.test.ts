/**
 * Teste de integração — `scripts/seed-pilot.ts` (Plan Task 15.1-15.4 / spec
 * go-live §10.3).
 *
 * Cobre:
 *   - Idempotência: rodar `runSeedPilot()` 2x produz mesmos IDs (organization,
 *     staff_account, professional, service).
 *   - Override por env: `BEVOX_PILOT_ORG_ID` é honrado.
 *
 * Sobe Postgres 16 (pg_uuidv7 empacotado) via testcontainers e aplica
 * migrations reais. Sem Redis nem buildServer — o seed-pilot só fala com o
 * pool do `@/db/client.js`.
 */

import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { GenericContainer, type StartedTestContainer, Wait } from "testcontainers";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const PG_IMAGE = "ghcr.io/fboulnois/pg_uuidv7:1.6.0";
const PG_DB = "bevox_backend_test";
const PG_USER = "bevox";
const PG_PASSWORD = "bevox_test_password";

// UUIDv7 estável escolhido para este teste — também usado no override do
// segundo `it`. Manter o `BEVOX_PILOT_ORG_ID` setado para ambos os testes
// preserva a invariante de idempotência (o helper relê env a cada chamada).
const PILOT_ORG_ID = "01939c83-8888-7000-8000-000000000001";

let pgContainer: StartedTestContainer;
let pool: pg.Pool;

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

  const dbUrl = `postgresql://${PG_USER}:${PG_PASSWORD}@${pgContainer.getHost()}:${pgContainer.getMappedPort(
    5432,
  )}/${PG_DB}`;

  process.env.NODE_ENV = "test";
  process.env.TEST_AUTH_BYPASS_ENABLED = "true";
  process.env.DATABASE_URL = dbUrl;
  // REDIS_URL é exigido pelo env loader, mas seed-pilot não usa Redis.
  process.env.REDIS_URL = "redis://localhost:6379";
  process.env.STAFF_JWT_SECRET = "test-staff-jwt-secret-please-rotate-in-prod";
  // ID estável da org-piloto, requisito do spec §10.3 (restart-safe / DR drill).
  process.env.BEVOX_PILOT_ORG_ID = PILOT_ORG_ID;

  pool = new pg.Pool({ connectionString: dbUrl, max: 4 });
  await migrate(drizzle(pool), { migrationsFolder: "./db/migrations" });

  const { initDb } = await import("@/db/client.js");
  await initDb();
}, 180_000);

afterAll(async () => {
  const { closeDb } = await import("@/db/client.js");
  await closeDb();
  await pool?.end();
  await pgContainer?.stop();
});

describe("seed-pilot", () => {
  it("é idempotente: rodar 2x produz mesmos IDs", async () => {
    const { runSeedPilot } = await import("../../scripts/seed-pilot.js");
    const a = await runSeedPilot();
    const b = await runSeedPilot();
    expect(a.organizationId).toEqual(b.organizationId);
    expect(a.staffAccountId).toEqual(b.staffAccountId);
    expect(a.professionalId).toEqual(b.professionalId);
    expect(a.serviceId).toEqual(b.serviceId);
  });

  it("usa BEVOX_PILOT_ORG_ID se setada", async () => {
    const { runSeedPilot } = await import("../../scripts/seed-pilot.js");
    const r = await runSeedPilot();
    expect(r.organizationId).toEqual(PILOT_ORG_ID);
  });

  it("recusa rodar em production sem BEVOX_PILOT_STAFF_PASSWORD", async () => {
    const oldNodeEnv = process.env.NODE_ENV;
    const oldPwd = process.env.BEVOX_PILOT_STAFF_PASSWORD;
    process.env.NODE_ENV = "production";
    delete process.env.BEVOX_PILOT_STAFF_PASSWORD;
    try {
      const { runSeedPilot } = await import("../../scripts/seed-pilot.js");
      await expect(runSeedPilot()).rejects.toThrow(/BEVOX_PILOT_STAFF_PASSWORD must be set/);
    } finally {
      process.env.NODE_ENV = oldNodeEnv;
      if (oldPwd !== undefined) process.env.BEVOX_PILOT_STAFF_PASSWORD = oldPwd;
    }
  });
});
