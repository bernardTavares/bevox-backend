/**
 * Teste de integração da migration de fundação (Task 4).
 *
 * Sobe um Postgres 16 (imagem com extensão `pg_uuidv7` empacotada) via
 * testcontainers — porta efêmera própria, NÃO depende do compose local
 * nem das portas 5432/6379 do host. Aplica a(s) migration(s) geradas e
 * valida fidelidade ao PRD §11.2 + ADR-021. O DB é `organization_id`-
 * native e tem ZERO `workspace_id` — coerente com SP-3 Phase 2 / ADR-019
 * (ponte resolveOrganizationId colapsada; workspace_id retirado).
 *
 * Executa: pnpm test:integration test/integration/migration.test.ts
 * (precisa Docker).
 */

import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { GenericContainer, type StartedTestContainer, Wait } from "testcontainers";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// PG16 + pg_uuidv7 empacotado (gen_uuid_v7()). uuid-ossp e pg_trgm vêm do
// contrib padrão do Postgres, presentes nesta imagem.
const PG_IMAGE = "ghcr.io/fboulnois/pg_uuidv7:1.6.0";
const PG_DB = "bevox_backend_test";
const PG_USER = "bevox";
const PG_PASSWORD = "bevox_test_password";

const EXPECTED_TABLES = [
  "organizations",
  "organization_settings",
  "users",
  "professionals",
  "services",
  "professional_services",
  "service_policies",
  "customers",
  "customer_channels",
  "customer_facts",
  "executions",
  "audit_events",
  "staff_accounts",
  "staff_impersonations",
  "staff_refresh_tokens",
  // `ai_suggestions` was dropped by migration 0005 (audit A21). Removed.
];

let container: StartedTestContainer;
let pool: pg.Pool;

beforeAll(async () => {
  container = await new GenericContainer(PG_IMAGE)
    .withEnvironment({
      POSTGRES_DB: PG_DB,
      POSTGRES_USER: PG_USER,
      POSTGRES_PASSWORD: PG_PASSWORD,
    })
    .withExposedPorts(5432)
    .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))
    .withStartupTimeout(90_000)
    .start();

  const url = `postgresql://${PG_USER}:${PG_PASSWORD}@${container.getHost()}:${container.getMappedPort(
    5432,
  )}/${PG_DB}`;

  pool = new pg.Pool({ connectionString: url, max: 2 });
  const db = drizzle(pool);
  await migrate(db, { migrationsFolder: "./db/migrations" });
}, 120_000);

afterAll(async () => {
  await pool?.end();
  await container?.stop();
});

describe("foundation migration (PRD §11.2, ADR-021)", () => {
  it("creates all Marco-1 tables", async () => {
    const { rows } = await pool.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`,
    );
    const names = new Set(rows.map((r) => r.table_name));
    for (const t of EXPECTED_TABLES) {
      expect(names, `tabela ausente: ${t}`).toContain(t);
    }
  });

  it("has the pg_uuidv7 extension installed", async () => {
    const { rows } = await pool.query<{ extname: string }>(
      `SELECT extname FROM pg_extension WHERE extname = 'pg_uuidv7'`,
    );
    expect(rows.map((r) => r.extname)).toContain("pg_uuidv7");
  });

  it("idx_executions_token_hash is a PARTIAL UNIQUE index", async () => {
    const { rows } = await pool.query<{ indexdef: string; indisunique: boolean }>(
      `SELECT i.indexdef, x.indisunique
         FROM pg_indexes i
         JOIN pg_class c ON c.relname = i.indexname
         JOIN pg_index x ON x.indexrelid = c.oid
        WHERE i.indexname = 'idx_executions_token_hash'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.indisunique).toBe(true);
    // Partial: definição contém a cláusula WHERE.
    expect(rows[0]!.indexdef).toMatch(/WHERE /i);
    expect(rows[0]!.indexdef).toMatch(/done.*error.*cancelled.*dead_letter/i);
  });

  it("idx_customer_facts_active is a PARTIAL index", async () => {
    const { rows } = await pool.query<{ indexdef: string }>(
      `SELECT indexdef FROM pg_indexes WHERE indexname = 'idx_customer_facts_active'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.indexdef).toMatch(/WHERE .*superseded_by IS NULL/i);
  });

  it("has ZERO column named workspace_id in any table (ADR-021)", async () => {
    const { rows } = await pool.query<{ table_name: string; column_name: string }>(
      `SELECT table_name, column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND column_name = 'workspace_id'`,
    );
    expect(rows, `workspace_id encontrado: ${JSON.stringify(rows)}`).toHaveLength(0);
  });

  it("uses organization_id as the tenant column on tenant-scoped tables", async () => {
    const { rows } = await pool.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'executions'
          AND column_name = 'organization_id'`,
    );
    expect(rows).toHaveLength(1);
  });
});
