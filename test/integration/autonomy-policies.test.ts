/**
 * Teste de integração — `fetchOrgAutonomyPolicies` seam (POC).
 *
 * FINDING: `autonomy-action-granularity-not-enforced` (HIGH). Os três
 * JSONBs granulares em `autonomy_profiles` (`allowed_actions_json`,
 * `required_approvals_json`, `confidence_thresholds_json`) são gravados
 * pelo PATCH /autonomy mas NÃO entram em nenhuma decisão hoje. Este PR
 * (POC) entrega só a FUNDAÇÃO: o seam de LEITURA. Marco 2/3 conecta o
 * evaluator (ver TODO em `src/modules/autonomy/resolver.ts` +
 * `PolicyEvaluator` em `src/modules/autonomy/seams.ts`).
 *
 * Este test valida que:
 *   1. Org sem `autonomy_profile` → seam retorna `null` (read-only,
 *      NÃO cria profile lazy).
 *   2. Org com `autonomy_profile` default → seam retorna policies com
 *      `currentMode: 'manual_assisted'` e os 3 dicts vazios (JSONBs
 *      nullable no schema; parse normaliza null→{}).
 *   3. Org com 3 JSONBs persistidos via PATCH → seam devolve EXATAMENTE
 *      o shape persistido (round-trip fidelity é o ponto da POC).
 *   4. Seam NÃO toma nenhuma decisão — só lê (regressão guard: se
 *      `PolicyEvaluator` ganhar default impl por engano, este test
 *      continua passando porque ele NÃO chama evaluator).
 *
 * Mirror do lifecycle de container de `payments-policy-routes.test.ts`.
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

let orgWithProfile: string;
let orgWithGranularPolicies: string;
let orgNoProfile: string;

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

  orgWithProfile = await seedOrg("Org Autonomy Default Profile");
  orgWithGranularPolicies = await seedOrg("Org Autonomy Granular Policies");
  orgNoProfile = await seedOrg("Org Autonomy No Profile");
}, 180_000);

afterAll(async () => {
  await app?.close();
  const { closeDb } = await import("@/db/client.js");
  await closeDb();
  await pool?.end();
  await pgContainer?.stop();
  await redisContainer?.stop();
});

describe("fetchOrgAutonomyPolicies (POC seam)", () => {
  it("org sem autonomy_profile → seam retorna null (read-only path)", async () => {
    const { fetchOrgAutonomyPolicies } = await import("@/modules/autonomy/seams.js");
    const result = await fetchOrgAutonomyPolicies(orgNoProfile);
    expect(result).toBeNull();

    // Confirma side-effect zero: nenhum profile foi criado lazy pela
    // chamada do seam (read-only contract).
    const rows = await pool.query(`SELECT id FROM autonomy_profiles WHERE organization_id = $1`, [
      orgNoProfile,
    ]);
    expect(rows.rowCount).toBe(0);
  });

  it("org com profile default (JSONBs null) → currentMode manual_assisted + 3 dicts {}", async () => {
    // Trigger lazy creation via GET /autonomy (rota usa getOrCreateProfile).
    const getRes = await app.inject({
      method: "GET",
      url: `/api/v1/organizations/${orgWithProfile}/autonomy`,
      headers: authHeaders(orgWithProfile),
    });
    expect(getRes.statusCode, getRes.body).toBe(200);

    const { fetchOrgAutonomyPolicies } = await import("@/modules/autonomy/seams.js");
    const result = await fetchOrgAutonomyPolicies(orgWithProfile);
    expect(result).not.toBeNull();
    expect(result!.organizationId).toBe(orgWithProfile);
    expect(result!.currentMode).toBe("manual_assisted");
    // JSONBs nullable no schema → parse normaliza null para {} para o
    // evaluator futuro nunca precisar branch-check null.
    expect(result!.allowedActions).toEqual({});
    expect(result!.requiredApprovals).toEqual({});
    expect(result!.confidenceThresholds).toEqual({});
  });

  it("org com 3 JSONBs persistidos via PATCH → seam devolve shape parsed idêntico", async () => {
    // Seed granular policies — shape exemplar do canon FUTURO (Marco 2/3
    // fixa o vocabulário; este test só prova round-trip do persistido).
    const allowed = {
      "create-appointment": true,
      "create-charge": { mode_floor: "autonomous_supervised" },
      "create-refund": false,
    };
    const required = {
      "create-appointment": "none",
      "create-charge": "professional",
      "create-refund": "staff",
    };
    const thresholds = {
      "create-appointment": 0.8,
      "create-charge": 0.95,
      "create-refund": 1.0,
    };

    const patchRes = await app.inject({
      method: "PATCH",
      url: `/api/v1/organizations/${orgWithGranularPolicies}/autonomy`,
      headers: authHeaders(orgWithGranularPolicies),
      payload: {
        allowed_actions_json: allowed,
        required_approvals_json: required,
        confidence_thresholds_json: thresholds,
      },
    });
    expect(patchRes.statusCode, patchRes.body).toBe(200);

    const { fetchOrgAutonomyPolicies } = await import("@/modules/autonomy/seams.js");
    const result = await fetchOrgAutonomyPolicies(orgWithGranularPolicies);
    expect(result).not.toBeNull();
    expect(result!.organizationId).toBe(orgWithGranularPolicies);
    expect(result!.currentMode).toBe("manual_assisted"); // PATCH não mudou mode.
    expect(result!.allowedActions).toEqual(allowed);
    expect(result!.requiredApprovals).toEqual(required);
    expect(result!.confidenceThresholds).toEqual(thresholds);
  });

  it("seam rejeita JSONB com shape inválido (array) — fail-loud guard", async () => {
    // Caminho de defesa: o PATCH schema bloqueia non-object hoje (Zod
    // `z.record`), mas dados legados / writes diretos por migration
    // poderiam produzir array. Provamos que o seam NÃO aceita
    // silenciosamente — necessário antes do evaluator entrar em uso para
    // não auto-aprovar por payload corrompido.
    const orgBadShape = await seedOrg("Org Autonomy Bad Shape");
    const { uuidv7 } = await import("@/shared/uuid.js");
    await pool.query(
      `INSERT INTO autonomy_profiles
         (id, organization_id, current_mode, allowed_actions_json)
       VALUES ($1, $2, 'manual_assisted', $3::jsonb)`,
      [uuidv7(), orgBadShape, JSON.stringify(["create-appointment"])],
    );

    const { fetchOrgAutonomyPolicies } = await import("@/modules/autonomy/seams.js");
    await expect(fetchOrgAutonomyPolicies(orgBadShape)).rejects.toThrow(
      /allowed_actions_json has invalid shape/,
    );
  });
});
