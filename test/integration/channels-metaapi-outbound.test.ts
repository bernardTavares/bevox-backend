/**
 * Integration test — full outbound flow (Marco 4 P2, T9).
 *
 * Cobre o trajeto completo do `deliverToChannel` seam contra Postgres real:
 *   (a) happy WA path: seed real (organization + customer + channel_connection
 *       + conversation + execution + organization_meta_api_tenant) + mocked
 *       client.sendMessage → status='sent' + audit_events row escrita
 *       (entity_type='metaapi_send', action='metaapi.send.success').
 *   (b) skipped_missing_tenant quando organization_meta_api_tenant ausente.
 *   (c) skipped_empty_text quando responseText vazio (não toca DB de contexto).
 *   (d) failed_retryable_exhausted on persistent META_UNAVAILABLE (4 tentativas).
 *   (e) IG plumb (task #20): provider=instagram → mocked INTERNAL →
 *       failed_retryable_exhausted channel=instagram.
 *
 * Convenção idêntica a channels-metaapi-inbound.test.ts (M4 P1, T16): env()
 * setado ANTES de qualquer import dinâmico que toque config/db. Mock do
 * `sendMessage` via `vi.mock` (ESM-hoisted) — `vi.spyOn` não funciona pra
 * named imports estáticos do seam.
 *
 * Executa: pnpm test:integration test/integration/channels-metaapi-outbound.test.ts
 */

import { createHash, randomBytes } from "node:crypto";

import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { GenericContainer, type StartedTestContainer, Wait } from "testcontainers";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const PG_IMAGE = "ghcr.io/fboulnois/pg_uuidv7:1.6.0";
const PG_DB = "bevox_backend_test";
const PG_USER = "bevox";
const PG_PASSWORD = "bevox_test_password";

const REDIS_IMAGE = "redis:7-alpine";

// UUIDv7 estático para a org de teste (versão=7, variant=b — `7xxx-bxxx`).
const ORG_ID_STATIC = "0193e45a-c5e4-7000-b000-000000000700";
// meta_api_tenant_id é text (não UUID); usamos string estável.
const TENANT_ID_STATIC = "metaapi_tenant_p2_test_001";

let pgContainer: StartedTestContainer;
let redisContainer: StartedTestContainer;
let pool: pg.Pool;

// Dynamic imports populados em beforeAll após env setup.
import type { deliverToChannel as DeliverToChannelFn } from "@/modules/executions/seams.js";
import type { uuidv7 as UuidV7Fn } from "@/shared/uuid.js";
import type { insertTenantMapping as InsertTenantMappingFn } from "@/modules/channels/metaapi/repository.js";

let deliverToChannel: typeof DeliverToChannelFn;
let uuidv7: typeof UuidV7Fn;
let insertTenantMapping: typeof InsertTenantMappingFn;

// Mock client.sendMessage ANTES de qualquer import de seams.ts.
// ESM-hoisted; o spy é configurado por teste via mockSendMessage.mockResolvedValue.
const mockSendMessage = vi.hoisted(() => vi.fn());
vi.mock("@/modules/channels/metaapi/client.js", () => ({
  sendMessage: mockSendMessage,
}));

function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

interface SeedOpts {
  customerPhone: string | null;
  withTenantMapping: boolean;
  provider?: "whatsapp" | "instagram";
}

/**
 * Insere fileira mínima: organization + customer + channel_connection +
 * conversation + execution. Opcionalmente popula organization_meta_api_tenant
 * + customer_channels (necessário pra IG case ter phone_number fallback).
 *
 * Schema reflete columns reais (NOT NULL sem default) inspecionados em
 * db/migrations/0000_youthful_shooting_star.sql + 0001 + 0002 + 0013.
 */
async function seed(opts: SeedOpts): Promise<{ executionId: string; conversationId: string }> {
  const customerId = uuidv7();
  const channelConnId = uuidv7();
  const conversationId = uuidv7();
  const executionId = uuidv7();
  const provider = opts.provider ?? "whatsapp";

  // organizations: id + name + business_name + niche + timezone + currency + locale all NOT NULL.
  await pool.query(
    `INSERT INTO organizations
       (id, name, business_name, niche, timezone, currency, locale)
     VALUES ($1,'Test Org P2','Test Org P2 LTDA','clinica','America/Sao_Paulo','BRL','pt-BR')
     ON CONFLICT (id) DO NOTHING`,
    [ORG_ID_STATIC],
  );

  // customers: id + organization_id + full_name NOT NULL. primary_phone optional.
  await pool.query(
    `INSERT INTO customers (id, organization_id, full_name, primary_phone)
     VALUES ($1, $2, 'Cliente Teste P2', $3)`,
    [customerId, ORG_ID_STATIC, opts.customerPhone],
  );

  // channel_connections: status check constraint = pending|connected|error|revoked.
  // Use 'connected' (não 'active') pra refletir estado real de canal apto.
  await pool.query(
    `INSERT INTO channel_connections
       (id, organization_id, provider, external_account_id, status)
     VALUES ($1, $2, $3, 'wa_phone_xyz', 'connected')`,
    [channelConnId, ORG_ID_STATIC, provider],
  );

  // customer_channels: necessário pra findExecutionDeliveryContext fazer LEFT JOIN
  // com is_primary=TRUE. Pra IG case (sem primary_phone), o phone_number aqui é
  // o fallback. Inserimos sempre — não atrapalha o WA path que tem primary_phone.
  await pool.query(
    `INSERT INTO customer_channels
       (id, organization_id, customer_id, provider, external_user_id,
        phone_number, is_primary)
     VALUES ($1, $2, $3, $4, $5, $6, TRUE)`,
    [
      uuidv7(),
      ORG_ID_STATIC,
      customerId,
      provider,
      provider === "instagram" ? "ig_psid_abc" : "5511999999999",
      opts.customerPhone,
    ],
  );

  // conversations: id + organization_id + customer_id + status + current_owner_type NOT NULL.
  // status check = open|waiting_human|waiting_customer|closed.
  // current_owner_type check = ai|user|queue.
  await pool.query(
    `INSERT INTO conversations
       (id, organization_id, customer_id, channel_connection_id, status, current_owner_type)
     VALUES ($1, $2, $3, $4, 'open', 'ai')`,
    [conversationId, ORG_ID_STATIC, customerId, channelConnId],
  );

  // executions: id + organization_id + conversation_id + execution_mode + status +
  // execution_token_hash + processing_endpoint_url + processing_timeout_ms NOT NULL.
  // execution_mode check = manual_assisted|copilot|autonomous_supervised.
  // status check = pending|dispatching|processing|waiting_input|completing|
  //                waiting_approval|done|error|timeout|cancelled|dead_letter.
  const token = randomBytes(32).toString("hex");
  await pool.query(
    `INSERT INTO executions
       (id, organization_id, conversation_id, execution_mode, status,
        execution_token_hash, processing_endpoint_url, processing_timeout_ms)
     VALUES ($1, $2, $3, 'autonomous_supervised', 'done', $4, 'http://harness.local', 120000)`,
    [executionId, ORG_ID_STATIC, conversationId, sha256(token)],
  );

  if (opts.withTenantMapping) {
    await insertTenantMapping({
      organizationId: ORG_ID_STATIC,
      metaApiTenantId: TENANT_ID_STATIC,
    });
  }
  return { executionId, conversationId };
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
  process.env.AEAD_MASTER_KEY = "f".repeat(64);
  process.env.META_API_BASE_URL = "http://test-meta-api.invalid";
  process.env.META_API_APP_ID = "test-app";
  process.env.META_API_KEY_ID = "test-key-id";
  process.env.META_API_PRIVATE_KEY_PEM = "dummy-pem-not-used-in-test";
  process.env.META_API_TIMEOUT_MS = "12000";

  pool = new pg.Pool({ connectionString: dbUrl, max: 4 });
  await migrate(drizzle(pool), { migrationsFolder: "./db/migrations" });

  const seamMod = await import("@/modules/executions/seams.js");
  const { initDb } = await import("@/db/client.js");
  const uuidMod = await import("@/shared/uuid.js");
  const repoMod = await import("@/modules/channels/metaapi/repository.js");
  deliverToChannel = seamMod.deliverToChannel;
  uuidv7 = uuidMod.uuidv7;
  insertTenantMapping = repoMod.insertTenantMapping;

  await initDb();
}, 180_000);

afterAll(async () => {
  const { closeDb } = await import("@/db/client.js");
  await closeDb();
  await pool?.end();
  await pgContainer?.stop();
  await redisContainer?.stop();
});

beforeEach(() => {
  mockSendMessage.mockReset();
});

afterEach(async () => {
  vi.useRealTimers();
  // Limpa em ordem reversa de FK pra evitar constraint violation.
  await pool.query(`DELETE FROM audit_events WHERE entity_type = 'metaapi_send'`);
  await pool.query(`DELETE FROM executions WHERE organization_id = $1`, [ORG_ID_STATIC]);
  await pool.query(`DELETE FROM conversations WHERE organization_id = $1`, [ORG_ID_STATIC]);
  await pool.query(`DELETE FROM customer_channels WHERE organization_id = $1`, [ORG_ID_STATIC]);
  await pool.query(`DELETE FROM channel_connections WHERE organization_id = $1`, [ORG_ID_STATIC]);
  await pool.query(`DELETE FROM customers WHERE organization_id = $1`, [ORG_ID_STATIC]);
  await pool.query(`DELETE FROM organization_meta_api_tenant WHERE organization_id = $1`, [
    ORG_ID_STATIC,
  ]);
});

describe("deliverToChannel — integration (M4 P2 outbound full flow)", () => {
  it("(a) happy WA path: real DB seed + mocked sendMessage → sent + audit row", async () => {
    mockSendMessage.mockResolvedValue({
      status: "sent",
      channel: "whatsapp",
      message_id: "msg_1",
      provider_message_id: "wamid.1",
    });
    const { executionId, conversationId } = await seed({
      customerPhone: "5511999999999",
      withTenantMapping: true,
    });

    const r = await deliverToChannel({
      organizationId: ORG_ID_STATIC,
      conversationId,
      responseText: "Olá!",
      executionId,
    });

    expect(r.status).toBe("sent");
    if (r.status !== "sent") return;
    expect(r.channel).toBe("whatsapp");
    expect(r.message_id).toBe("msg_1");
    expect(r.provider_message_id).toBe("wamid.1");
    expect(r.attempt_count).toBe(1);

    const audit = await pool.query<{ entity_type: string; action: string }>(
      `SELECT entity_type, action FROM audit_events
        WHERE entity_type = 'metaapi_send' AND entity_id = $1`,
      [executionId],
    );
    expect(audit.rowCount).toBe(1);
    expect(audit.rows[0]!.action).toBe("metaapi.send.success");
    expect(mockSendMessage).toHaveBeenCalledTimes(1);
  });

  it("(b) skipped_missing_tenant when organization_meta_api_tenant absent", async () => {
    mockSendMessage.mockRejectedValue(new Error("should not call"));
    const { executionId, conversationId } = await seed({
      customerPhone: "5511999",
      withTenantMapping: false,
    });
    const r = await deliverToChannel({
      organizationId: ORG_ID_STATIC,
      conversationId,
      responseText: "hi",
      executionId,
    });
    expect(r.status).toBe("skipped_missing_tenant");
    if (r.status !== "skipped_missing_tenant") return;
    expect(r.organization_id).toBe(ORG_ID_STATIC);
    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  it("(c) skipped_empty_text when responseText is empty (no DB context lookup)", async () => {
    mockSendMessage.mockRejectedValue(new Error("should not call"));
    const { executionId, conversationId } = await seed({
      customerPhone: "5511999",
      withTenantMapping: true,
    });
    const r = await deliverToChannel({
      organizationId: ORG_ID_STATIC,
      conversationId,
      responseText: "   ",
      executionId,
    });
    expect(r.status).toBe("skipped_empty_text");
    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  it("(d) failed_retryable_exhausted on persistent META_UNAVAILABLE (4 attempts)", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mockSendMessage.mockResolvedValue({
      status: "error",
      code: "META_UNAVAILABLE",
      message: "Meta down",
    });
    const { executionId, conversationId } = await seed({
      customerPhone: "5511999",
      withTenantMapping: true,
    });

    const promise = deliverToChannel({
      organizationId: ORG_ID_STATIC,
      conversationId,
      responseText: "hi",
      executionId,
    });
    await vi.runAllTimersAsync();
    const r = await promise;

    expect(r.status).toBe("failed_retryable_exhausted");
    if (r.status !== "failed_retryable_exhausted") return;
    expect(r.attempt_count).toBe(4);
    expect(r.error_code).toBe("META_UNAVAILABLE");
    expect(mockSendMessage).toHaveBeenCalledTimes(4);
  });

  it("(e) IG plumb (task #20): mocked INTERNAL → failed_retryable_exhausted channel=instagram", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mockSendMessage.mockResolvedValue({
      status: "error",
      code: "INTERNAL",
      message: "Instagram task #20",
    });
    const { executionId, conversationId } = await seed({
      customerPhone: "ig_psid_abc",
      withTenantMapping: true,
      provider: "instagram",
    });

    const promise = deliverToChannel({
      organizationId: ORG_ID_STATIC,
      conversationId,
      responseText: "hi from IG",
      executionId,
    });
    await vi.runAllTimersAsync();
    const r = await promise;

    expect(r.status).toBe("failed_retryable_exhausted");
    if (r.status !== "failed_retryable_exhausted") return;
    expect(r.channel).toBe("instagram");
    expect(r.error_code).toBe("INTERNAL");
    expect(r.attempt_count).toBe(4);
  });
});
