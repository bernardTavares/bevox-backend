/**
 * Teste de integração E2E — approve execution com create-refund proposal (M5-P3b Task 7).
 *
 * Prova a wiring cross-módulo completa:
 *   POST /executions/:id/approve
 *     → runApproval → executeProposals → handleCreateRefund
 *     → refundCharge (Stripe mocked) → refund row real no DB
 *     + audit charge.refund_initiated com actor_id = approver users.id
 *     + approved_by_clerk_user_id no after_json
 *     + execution → done
 *
 * Convenção idêntica a channels-metaapi-outbound.test.ts:
 *   - vi.mock ESM-hoisted NO TOPO do arquivo (antes de qualquer import de app-code)
 *   - dynamic import em beforeAll após env setup
 *   - testcontainers PG + Redis lifecycle mirror de payments-manual-routes.test.ts
 *   - authHeaders via test-seam header x-test-clerk-organization (clerk_user_id='test_clerk_user')
 */

import { vi } from "vitest";

// ESM-hoisted: deve estar ANTES de qualquer import de módulo de app.
// var name começa com `mock` para satisfazer hoisting do vitest.
const mockStripeRefundsCreate = vi.hoisted(() =>
  vi.fn(async () => ({ id: "re_e2e_1", status: "succeeded" })),
);
vi.mock("@/modules/payments/stripe-client.js", () => ({
  getStripe: () => ({ refunds: { create: mockStripeRefundsCreate } }),
}));

// Mock meta-api send para simular sucesso sem chamar Meta real
// (precondition do POC outgoing-messages-not-persisted: o seam só persiste
// outgoing row em DB quando lastResult.status === 'sent'). Convenção
// ESM-hoisted idêntica à de channels-metaapi-outbound.test.ts.
const mockMetaApiSendMessage = vi.hoisted(() =>
  vi.fn(async () => ({
    status: "sent" as const,
    channel: "whatsapp",
    message_id: "msg_e2e_1",
    provider_message_id: "wamid.e2e_1",
  })),
);
vi.mock("@/modules/channels/metaapi/client.js", () => ({
  sendMessage: mockMetaApiSendMessage,
}));

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
  // Meta-api outbound seam exige estas envs em runtime
  // (validateAndBuild + insertTenantMapping tocam AEAD + payload builder).
  process.env.AEAD_MASTER_KEY = "f".repeat(64);
  process.env.META_API_BASE_URL = "http://test-meta-api.invalid";
  process.env.META_API_APP_ID = "test-app";
  process.env.META_API_KEY_ID = "test-key-id";
  process.env.META_API_PRIVATE_KEY_PEM = "dummy-pem-not-used-in-test";
  process.env.META_API_TIMEOUT_MS = "12000";

  pool = new pg.Pool({ connectionString: dbUrl, max: 4 });
  await migrate(drizzle(pool), { migrationsFolder: "./db/migrations" });

  const { buildServer } = await import("@/bootstrap/server.js");
  const { initDb } = await import("@/db/client.js");
  await initDb();
  app = await buildServer();
  await app.ready();
}, 180_000);

afterAll(async () => {
  await app?.close();
  const { closeDb } = await import("@/db/client.js");
  await closeDb();
  await pool?.end();
  await pgContainer?.stop();
  await redisContainer?.stop();
});

describe("POST /executions/:id/approve com create-refund proposal (E2E)", () => {
  it("approve de execution com create-refund → refund real + audit atribuído + execution done", async () => {
    const { uuidv7 } = await import("@/shared/uuid.js");

    // Seed: organization
    const orgId = uuidv7();
    await pool.query(
      `INSERT INTO organizations (id, name, business_name, niche, timezone, currency, locale)
       VALUES ($1,$2,$2,'clinica','America/Sao_Paulo','BRL','pt-BR')`,
      [orgId, "E2E Refund Org"],
    );
    await pool.query(`INSERT INTO organization_settings (organization_id) VALUES ($1)`, [orgId]);

    // Seed: customer (com primary_phone para deliverToChannel passar do step 2)
    const customerId = uuidv7();
    await pool.query(
      `INSERT INTO customers (id, organization_id, full_name, primary_phone)
       VALUES ($1,$2,'Cliente E2E','5511988887777')`,
      [customerId, orgId],
    );

    // Seed: channel_connection (necessário para findExecutionDeliveryContext
    // resolver provider + external_account_id; sem ele, deliverToChannel
    // retorna skipped_missing_recipient).
    const channelConnId = uuidv7();
    await pool.query(
      `INSERT INTO channel_connections
         (id, organization_id, provider, external_account_id, status)
       VALUES ($1,$2,'whatsapp','wa_phone_e2e','connected')`,
      [channelConnId, orgId],
    );

    // Seed: customer_channel (fallback phone path do LEFT JOIN)
    await pool.query(
      `INSERT INTO customer_channels
         (id, organization_id, customer_id, provider, external_user_id,
          phone_number, is_primary)
       VALUES ($1,$2,$3,'whatsapp','5511988887777','5511988887777',TRUE)`,
      [uuidv7(), orgId, customerId],
    );

    // Seed: conversation com channel_connection_id (necessário para o seam
    // resolver provider). Status + current_owner_type são NOT NULL.
    const conversationId = uuidv7();
    await pool.query(
      `INSERT INTO conversations
         (id, organization_id, customer_id, channel_connection_id, status, current_owner_type)
       VALUES ($1,$2,$3,$4,'open','ai')`,
      [conversationId, orgId, customerId, channelConnId],
    );

    // Seed: conversation_pipeline_state — fornece conversation_key canônica
    // que findExecutionDeliveryContext leva para insertMessageRecord (POC).
    // Sem este row, conversationKey vem null e outgoing persistence é skipped.
    const pipelineId = uuidv7();
    const conversationKey = `channel:wa:wa_phone_e2e:cust_e2e`;
    await pool.query(
      `INSERT INTO conversation_pipeline_state
         (id, organization_id, conversation_id, conversation_key,
          external_conversation_id, pipeline_status, version)
       VALUES ($1,$2,$3,$4,'cust_e2e','buffering','1')`,
      [pipelineId, orgId, conversationId, conversationKey],
    );

    // Seed: organization_meta_api_tenant — necessário para findMetaApiTenant
    // resolver tenant id (sem ele, deliverToChannel skip).
    await pool.query(
      `INSERT INTO organization_meta_api_tenant (organization_id, meta_api_tenant_id)
       VALUES ($1,'metaapi_tenant_e2e_test')
       ON CONFLICT (organization_id) DO NOTHING`,
      [orgId],
    );

    // Seed: incoming message_record (mensagem original do cliente). Espelha
    // a linha que routes.ts:255 grava no inbound flow. Permite o teste
    // assertir AMBOS direction='incoming' (pré-existente) e direction='outgoing'
    // (criada pós-delivery) na mesma conversation_key.
    await pool.query(
      `INSERT INTO message_records
         (id, conversation_key, external_message_id, direction, content_text,
          message_created_at, sender_snapshot_json)
       VALUES ($1,$2,'wamid.incoming.e2e','incoming','quero estornar',
               now(), $3::jsonb)`,
      [uuidv7(), conversationKey, JSON.stringify({ actor: "customer" })],
    );

    // Seed: stripe payment_account
    const paymentAccountId = uuidv7();
    await pool.query(
      `INSERT INTO payment_accounts
         (id, organization_id, provider, account_holder_type, onboarding_status, charges_enabled, external_account_id)
       VALUES ($1,$2,'stripe','organization','active',true,'acct_e2e')`,
      [paymentAccountId, orgId],
    );

    // Seed: paid Stripe charge (status='paid', provider_charge_id set — guard do refundCharge exige)
    const chargeId = uuidv7();
    await pool.query(
      `INSERT INTO charges
         (id, organization_id, customer_id, payment_account_id, charge_type, status,
          amount_total, currency, idempotency_key, provider_charge_id)
       VALUES ($1,$2,$3,$4,'full','paid','100.00','BRL','idem-e2e-charge','pi_e2e_1')`,
      [chargeId, orgId, customerId, paymentAccountId],
    );

    // Seed: user (para getUserIdByClerkId resolver o approver → actor_id)
    // test-seam fixa clerk_user_id='test_clerk_user'
    const approverUserId = uuidv7();
    await pool.query(
      `INSERT INTO users (id, organization_id, name, role, clerk_user_id)
       VALUES ($1,$2,'Approver','owner','test_clerk_user')`,
      [approverUserId, orgId],
    );

    // Seed: execution em waiting_approval com proposal create-refund
    const executionId = uuidv7();
    const resultPayload = JSON.stringify({
      response_text: "ok",
      proposals: [
        {
          action: "create-refund",
          params: {
            charge_id: chargeId,
            amount: 40,
            reason_code: "duplicate",
          },
          idempotency_key: "idem-e2e-refund",
        },
      ],
    });
    await pool.query(
      `INSERT INTO executions
         (id, organization_id, conversation_id, execution_mode, status,
          execution_token_hash, processing_endpoint_url, processing_timeout_ms, result_payload)
       VALUES ($1,$2,$3,'manual_assisted','waiting_approval',
               'hash-e2e','http://localhost',30000,$4::jsonb)`,
      [executionId, orgId, conversationId, resultPayload],
    );

    // Act: POST approve com test-seam header (clerk_user_id='test_clerk_user')
    // requireIdempotency exige o header Idempotency-Key
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/organizations/${orgId}/executions/${executionId}/approve`,
      headers: {
        "x-test-clerk-organization": orgId,
        "idempotency-key": `approve-e2e-${executionId}`,
      },
    });
    expect(res.statusCode, res.body).toBe(200);

    // Assert: Stripe mock foi chamado
    expect(mockStripeRefundsCreate).toHaveBeenCalledTimes(1);

    // Assert: refund row foi criado no DB com idempotency_key correto
    const refundRows = await pool.query(
      `SELECT status, amount, idempotency_key FROM refunds WHERE charge_id = $1`,
      [chargeId],
    );
    expect(refundRows.rows).toHaveLength(1);
    expect((refundRows.rows[0] as { idempotency_key: string | null }).idempotency_key).toBe(
      "idem-e2e-refund",
    );

    // Assert: audit charge.refund_initiated com actor_id = approver uuid + approved_by_clerk_user_id
    const auditRows = await pool.query(
      `SELECT actor_id, after_json FROM audit_events
         WHERE entity_type='charge' AND action='charge.refund_initiated' AND organization_id=$1`,
      [orgId],
    );
    expect(auditRows.rows).toHaveLength(1);
    const a = auditRows.rows[0] as {
      actor_id: string | null;
      after_json: { approved_by_clerk_user_id?: string };
    };
    expect(a.actor_id).toBe(approverUserId);
    expect(a.after_json.approved_by_clerk_user_id).toBe("test_clerk_user");

    // Assert: execution → done
    const exRows = await pool.query(`SELECT status FROM executions WHERE id = $1`, [executionId]);
    expect((exRows.rows[0] as { status: string }).status).toBe("done");

    // Assert (POC HIGH outgoing-messages-not-persisted): outgoing message_record
    // foi gravado pós-delivery. Tabela deve conter AMBAS as linhas:
    //   - incoming (cliente original, seeded acima)
    //   - outgoing (resposta da IA, persistida pelo seam pós-send)
    // Sem o fix do POC, só a linha incoming existiria → IA perderia próprio
    // histórico assistant em conversas multi-turno (viola PRD §8.1 passo 9).
    const messageRows = await pool.query<{
      direction: string;
      content_text: string | null;
      external_message_id: string;
      sender_snapshot_json: { actor?: string; execution_id?: string } | null;
      received_event_id: string | null;
    }>(
      `SELECT direction, content_text, external_message_id, sender_snapshot_json,
              received_event_id
         FROM message_records
        WHERE conversation_key = $1
        ORDER BY direction DESC`, // outgoing antes de incoming
      [conversationKey],
    );
    expect(messageRows.rows).toHaveLength(2);
    const outgoing = messageRows.rows[0]!;
    expect(outgoing.direction).toBe("outgoing");
    expect(outgoing.content_text).toBe("ok"); // response_text do payload
    expect(outgoing.external_message_id).toBe("wamid.e2e_1"); // provider_message_id do mock
    expect(outgoing.sender_snapshot_json?.actor).toBe("ai");
    expect(outgoing.sender_snapshot_json?.execution_id).toBe(executionId);
    expect(outgoing.received_event_id).toBeNull(); // outbound não tem envelope

    const incoming = messageRows.rows[1]!;
    expect(incoming.direction).toBe("incoming");
    expect(incoming.content_text).toBe("quero estornar");

    // Assert: meta-api send mock foi chamado exatamente uma vez
    expect(mockMetaApiSendMessage).toHaveBeenCalledTimes(1);
  });
});
