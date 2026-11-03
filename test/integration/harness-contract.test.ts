/**
 * Teste de integração — contrato backend ↔ bevox-harness (Task 6, PRD §10.4).
 *
 * SP-3 Phase 2 (ADR-019): o harness é `organization_id`-native; a ponte
 * resolveOrganizationId foi colapsada. O backend despacha/lê
 * `organization_id` diretamente, sem tradução.
 *
 * Cobre:
 *   - harness STUB faz POST /api/v1/executions/:id/complete (campo tenant
 *     `organization_id`) com X-Execution-Token válido → 200, a linha
 *     `executions` transita dispatching→completing→done/waiting_approval,
 *     uma linha `audit_events` é escrita;
 *   - token inválido → 401;
 *   - o dispatcher enfileira um job `bevox.execution.dispatch` cujo payload
 *     valida contra DispatchPayloadSchema E cujo `organization_id` é o UUID
 *     da organização diretamente (sem `workspace_id`, sem transformação).
 */

import { createHash, randomBytes } from "node:crypto";

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
let convId: string;

function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
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
  // This suite does not use the Clerk test-seam header (its auth is
  // X-Execution-Token, a different mechanism), so the flag is not
  // strictly required here. Set it for consistency with the rest of
  // the integration suite and to document that NODE_ENV=test alone
  // is no longer sufficient to enable any Clerk/org-scope test seam
  // (finding test-seam-auth-bypass-on-nodeenv-test).
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

  const { uuidv7 } = await import("@/shared/uuid.js");
  orgId = uuidv7();
  await pool.query(
    `INSERT INTO organizations
       (id, name, business_name, niche, timezone, currency, locale)
     VALUES ($1,'Org H','Org H LTDA','clinica','America/Sao_Paulo','BRL','pt-BR')`,
    [orgId],
  );

  // executions.conversation_id is a NOT NULL FK to conversations (active since
  // Marco 2), and conversations.customer_id a NOT NULL FK to customers. Seed
  // the minimal chain once so executions inserts satisfy the FK.
  const customerId = uuidv7();
  await pool.query(
    `INSERT INTO customers (id, organization_id, full_name) VALUES ($1,$2,'Cliente H')`,
    [customerId, orgId],
  );
  convId = uuidv7();
  await pool.query(
    `INSERT INTO conversations
       (id, organization_id, customer_id, status, current_owner_type)
     VALUES ($1,$2,$3,'open','ai')`,
    [convId, orgId, customerId],
  );
}, 180_000);

afterAll(async () => {
  await app?.close();
  const { closeDb } = await import("@/db/client.js");
  await closeDb();
  const { closeQueues } = await import("@/lib/queues.js");
  await closeQueues();
  await pool?.end();
  await pgContainer?.stop();
  await redisContainer?.stop();
});

describe("backend → harness dispatch (BullMQ)", () => {
  it("enqueues a bevox.execution.dispatch job validating DispatchPayloadSchema with organization_id direct", async () => {
    const { dispatchExecution } = await import("@/integration/harness-dispatcher.js");
    const { DispatchPayloadSchema } = await import("@/integration/harness-dispatch.schema.js");
    const { getExecutionDispatchQueue } = await import("@/lib/queues.js");

    const { execution_id, payload } = await dispatchExecution({
      organizationId: orgId,
      executionMode: "manual_assisted",
      conversation: {
        id: convId,
        channel_account_id: (await import("@/shared/uuid.js")).uuidv7(),
      },
      messages: [{ role: "user", content: "Olá, quero agendar" }],
      context: { timezone: "America/Sao_Paulo", locale: "pt-BR" },
      agentConfig: { default_model: "openai/gpt-4o-mini", system_prompt: "You are helpful." },
      skills: ["scheduler"],
    });

    // Payload validates against the canonical schema. The tenant field is
    // `organization_id` and carries the org UUID directly (no translation).
    const parsed = DispatchPayloadSchema.parse(payload);
    expect(parsed.execution_id).toBe(execution_id);
    expect(parsed.organization_id).toBe(orgId);
    expect((parsed as Record<string, unknown>).workspace_id).toBeUndefined();

    // The executions row exists and carries the token hash.
    const row = await pool.query<{ status: string; execution_token_hash: string }>(
      `SELECT status, execution_token_hash FROM executions WHERE id = $1`,
      [execution_id],
    );
    expect(row.rowCount).toBe(1);
    expect(row.rows[0]!.status).toBe("dispatching");

    // Job is enqueued under the canonical queue with jobId = execution_id-derived.
    const queue = getExecutionDispatchQueue();
    const job = await queue.getJob(execution_id);
    expect(job).toBeTruthy();
    expect(DispatchPayloadSchema.parse(job!.data).organization_id).toBe(orgId);
  });

  // Dispatch-contract amendment (PRD §10.4, aceito 2026-06-03).
  it("carries deadline_ms = dispatched_at(DB) + processing_timeout_ms and threads original_execution_id on replay", async () => {
    const { dispatchExecution } = await import("@/integration/harness-dispatcher.js");
    const { uuidv7 } = await import("@/shared/uuid.js");

    const baseInput = () => ({
      organizationId: orgId,
      executionMode: "manual_assisted" as const,
      conversation: { id: convId, channel_account_id: uuidv7() },
      messages: [{ role: "user" as const, content: "Oi" }],
      context: { timezone: "America/Sao_Paulo", locale: "pt-BR" },
      agentConfig: { default_model: "openai/gpt-4o-mini", system_prompt: "x" },
    });

    // Normal dispatch: absolute deadline aligned to the DB clock; no lineage.
    const normal = await dispatchExecution(baseInput());
    expect(typeof normal.payload.deadline_ms).toBe("number");
    const r1 = await pool.query<{
      dispatched_at: Date;
      processing_timeout_ms: number;
      original_execution_id: string | null;
    }>(
      `SELECT dispatched_at, processing_timeout_ms, original_execution_id
         FROM executions WHERE id = $1`,
      [normal.execution_id],
    );
    expect(normal.payload.deadline_ms).toBe(
      r1.rows[0]!.dispatched_at.getTime() + r1.rows[0]!.processing_timeout_ms,
    );
    expect(normal.payload.original_execution_id).toBeUndefined();
    expect(r1.rows[0]!.original_execution_id).toBeNull();

    // Replay dispatch: the lineage root flows to both payload and column.
    const root = uuidv7();
    const replay = await dispatchExecution({ ...baseInput(), originalExecutionId: root });
    expect(replay.payload.original_execution_id).toBe(root);
    const r2 = await pool.query<{ original_execution_id: string | null }>(
      `SELECT original_execution_id FROM executions WHERE id = $1`,
      [replay.execution_id],
    );
    expect(r2.rows[0]!.original_execution_id).toBe(root);
  });
});

describe("staff-ops lineage — findExecutionForAction surfaces original_execution_id", () => {
  it("returns the lineage root when set", async () => {
    const { findExecutionForAction } = await import("@/modules/staff-ops/actions.repository.js");
    const { uuidv7 } = await import("@/shared/uuid.js");
    const root = uuidv7();
    const child = uuidv7();
    await pool.query(
      `INSERT INTO executions
         (id, organization_id, conversation_id, execution_mode, status,
          execution_token_hash, processing_endpoint_url, processing_timeout_ms,
          original_execution_id)
       VALUES ($1,$2,$3,'manual_assisted','dead_letter',$4,'http://h.local',120000,$5)`,
      [child, orgId, convId, sha256(randomBytes(32).toString("hex")), root],
    );
    const row = await findExecutionForAction(child);
    expect(row?.original_execution_id).toBe(root);
  });
});

// Dispatch-contract amendment (PRD §10.4 + ADR-019 Amendment 1, aceito
// 2026-06-03): PATCH /status='dead_letter' is the authoritative, idempotent
// terminal transition. It wins over `error` (and any non-`done` state), is a
// no-op over `done`/`cancelled`/`dead_letter`, and NEVER overwrites `done`.
// Its token auth resolves the execution regardless of status (Option 2 —
// dead-letter-aware lookup), so a terminal execution can still be dead-lettered.
describe("harness → backend /status dead_letter (authoritative transition)", () => {
  async function makeExecutionAt(status: string): Promise<{ id: string; token: string }> {
    const { uuidv7 } = await import("@/shared/uuid.js");
    const id = uuidv7();
    const token = randomBytes(32).toString("hex");
    await pool.query(
      `INSERT INTO executions
         (id, organization_id, conversation_id, execution_mode, status,
          execution_token_hash, processing_endpoint_url, processing_timeout_ms)
       VALUES ($1,$2,$3,'manual_assisted',$4,$5,'http://h.local',120000)`,
      [id, orgId, convId, status, sha256(token)],
    );
    return { id, token };
  }
  function patchDeadLetter(id: string, token: string) {
    return app.inject({
      method: "PATCH",
      url: `/api/v1/executions/${id}/status`,
      headers: { "x-execution-token": token },
      payload: { status: "dead_letter" },
    });
  }
  async function statusOf(id: string): Promise<string> {
    const r = await pool.query<{ status: string }>(`SELECT status FROM executions WHERE id = $1`, [
      id,
    ]);
    return r.rows[0]!.status;
  }
  async function retryExhaustedCount(id: string): Promise<number> {
    const r = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM audit_events
        WHERE execution_id = $1 AND action = 'retry_exhausted'`,
      [id],
    );
    return Number(r.rows[0]!.n);
  }

  it("wins over 'error' → dead_letter (200) + one retry_exhausted audit", async () => {
    const { id, token } = await makeExecutionAt("error");
    const res = await patchDeadLetter(id, token);
    expect(res.statusCode, res.body).toBe(200);
    expect(await statusOf(id)).toBe("dead_letter");
    expect(await retryExhaustedCount(id)).toBe(1);
  });

  it("wins over a live state ('processing') → dead_letter", async () => {
    const { id, token } = await makeExecutionAt("processing");
    expect((await patchDeadLetter(id, token)).statusCode).toBe(200);
    expect(await statusOf(id)).toBe("dead_letter");
  });

  it("NEVER overwrites 'done' (stays done, 200, no retry_exhausted)", async () => {
    const { id, token } = await makeExecutionAt("done");
    expect((await patchDeadLetter(id, token)).statusCode).toBe(200);
    expect(await statusOf(id)).toBe("done");
    expect(await retryExhaustedCount(id)).toBe(0);
  });

  it("is idempotent on re-POST (still dead_letter, exactly one retry_exhausted)", async () => {
    const { id, token } = await makeExecutionAt("error");
    await patchDeadLetter(id, token);
    const res2 = await patchDeadLetter(id, token);
    expect(res2.statusCode).toBe(200);
    expect(await statusOf(id)).toBe("dead_letter");
    expect(await retryExhaustedCount(id)).toBe(1);
  });

  it("no-ops on 'cancelled' (human decision prevails, 200)", async () => {
    const { id, token } = await makeExecutionAt("cancelled");
    expect((await patchDeadLetter(id, token)).statusCode).toBe(200);
    expect(await statusOf(id)).toBe("cancelled");
  });
});

describe("harness → backend callbacks (X-Execution-Token)", () => {
  async function makeExecution(): Promise<{ id: string; token: string }> {
    const { uuidv7 } = await import("@/shared/uuid.js");
    const id = uuidv7();
    const token = randomBytes(32).toString("hex"); // 64 hex
    await pool.query(
      `INSERT INTO executions
         (id, organization_id, conversation_id, execution_mode, status,
          execution_token_hash, processing_endpoint_url, processing_timeout_ms)
       VALUES ($1,$2,$3,'manual_assisted','dispatching',$4,'http://harness.local',120000)`,
      [id, orgId, convId, sha256(token)],
    );
    return { id, token };
  }

  it("POST /complete with valid token → 200, dispatching→completing→waiting_approval, audit_events written", async () => {
    const { id, token } = await makeExecution();
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/executions/${id}/complete`,
      headers: { "x-execution-token": token },
      payload: {
        organization_id: orgId,
        response_text: "Posso te ajudar a agendar.",
        sentiment: "positive",
        strategy: "direct",
        usage: { prompt_tokens: 0, completion_tokens: 0 },
        proposals: [],
      },
    });
    expect(res.statusCode, res.body).toBe(200);

    const row = await pool.query<{ status: string; result_payload: unknown }>(
      `SELECT status, result_payload FROM executions WHERE id = $1`,
      [id],
    );
    // manual_assisted → waiting_approval
    expect(row.rows[0]!.status).toBe("waiting_approval");
    expect(JSON.stringify(row.rows[0]!.result_payload)).toContain("agendar");

    const audit = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM audit_events
        WHERE execution_id = $1 AND entity_type = 'execution'`,
      [id],
    );
    expect(Number(audit.rows[0]!.n)).toBeGreaterThanOrEqual(1);
  });

  it("autonomous_supervised /complete → status done", async () => {
    const { uuidv7 } = await import("@/shared/uuid.js");
    const id = uuidv7();
    const token = randomBytes(32).toString("hex");
    await pool.query(
      `INSERT INTO executions
         (id, organization_id, conversation_id, execution_mode, status,
          execution_token_hash, processing_endpoint_url, processing_timeout_ms)
       VALUES ($1,$2,$3,'autonomous_supervised','processing',$4,'http://h.local',120000)`,
      [id, orgId, convId, sha256(token)],
    );
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/executions/${id}/complete`,
      headers: { "x-execution-token": token },
      payload: {
        organization_id: orgId,
        response_text: "Agendado.",
        sentiment: "neutral",
        strategy: "direct",
        usage: { prompt_tokens: 0, completion_tokens: 0 },
      },
    });
    expect(res.statusCode, res.body).toBe(200);
    const row = await pool.query<{ status: string }>(
      `SELECT status FROM executions WHERE id = $1`,
      [id],
    );
    expect(row.rows[0]!.status).toBe("done");
  });

  it("invalid token → 401", async () => {
    const { id } = await makeExecution();
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/executions/${id}/complete`,
      headers: { "x-execution-token": "0".repeat(64) },
      payload: {
        organization_id: orgId,
        response_text: "x",
        sentiment: "neutral",
        strategy: "direct",
        usage: { prompt_tokens: 0, completion_tokens: 0 },
      },
    });
    expect(res.statusCode).toBe(401);
  });

  it("PATCH /status with valid token transitions execution", async () => {
    const { id, token } = await makeExecution();
    const res = await app.inject({
      method: "PATCH",
      url: `/api/v1/executions/${id}/status`,
      headers: { "x-execution-token": token },
      payload: { status: "running" },
    });
    expect(res.statusCode, res.body).toBe(200);
    const row = await pool.query<{ status: string }>(
      `SELECT status FROM executions WHERE id = $1`,
      [id],
    );
    expect(row.rows[0]!.status).toBe("processing");
  });
});
