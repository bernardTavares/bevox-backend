/**
 * Integration test — bevox-meta-api inbound full flow (Marco 4 P1, T16).
 *
 * Cobre via `app.inject` o trajeto completo do webhook:
 *   (a) verification_challenge echo (NO HMAC) → 200 {challenge}.
 *   (b) envelope canon + HMAC válido → 200 {status:accepted} +
 *       received_events row + audit_events row (entity_type='metaapi_event').
 *   (c) HMAC mismatch → 401.
 *   (d) replay (mesmo event_id) → 200 {status:replayed} (Redis SETNX 24h).
 *   (e) tenant_id sem mapeamento → 404 TENANT_NOT_MAPPED.
 *   (f) audit_events row escrita com action='metaapi.event.accepted'.
 *
 * Sobe Postgres 16 (pg_uuidv7 empacotado) + Redis via testcontainers, aplica
 * migrations e exercita o módulo HTTP real. Convenção idêntica a
 * staff-rbac.test.ts / organizations-crud.test.ts: env() setado ANTES de
 * qualquer import dinâmico que toque config/db/aead.
 *
 * Executa: pnpm test:integration test/integration/channels-metaapi-inbound.test.ts
 */

import { createHmac } from "node:crypto";

import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { GenericContainer, type StartedTestContainer, Wait } from "testcontainers";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import type { FastifyInstance } from "fastify";

const PG_IMAGE = "ghcr.io/fboulnois/pg_uuidv7:1.6.0";
const PG_DB = "bevox_backend_test";
const PG_USER = "bevox";
const PG_PASSWORD = "bevox_test_password";

const REDIS_IMAGE = "redis:7-alpine";

const SUB_SECRET = "integration-test-secret-abc-123";
// UUIDv7 literais (versão=7, variant=b — `7xxx-bxxx`) válidos contra o
// schema Zod do envelope (metaApiEventEnvelopeSchema.tenant_id).
const TENANT_ID = "0193e45a-c5e4-7000-b000-000000000200";

let pgContainer: StartedTestContainer;
let redisContainer: StartedTestContainer;
let pool: pg.Pool;
let app: FastifyInstance;
let uuidv7: () => string;
let orgId: string;

/** Stripe-style HMAC signing (consumer-integration-guide §3.4). */
function sign(rawBody: string, secret = SUB_SECRET): string {
  const t = Math.floor(Date.now() / 1000);
  const v1 = createHmac("sha256", secret).update(`${t}.${rawBody}`).digest("hex");
  return `t=${t},v1=${v1}`;
}

interface Envelope {
  event_id: string;
  event_type: string;
  tenant_id: string | null;
  occurred_at: string;
  data: Record<string, unknown>;
}

/** Envelope factory — event_id fresh per call (avoids dedupe collisions). */
function makeEnvelope(over: Partial<Envelope> = {}): Envelope {
  return {
    event_id: uuidv7(),
    event_type: "message.received",
    tenant_id: TENANT_ID,
    occurred_at: new Date().toISOString(),
    data: {
      messaging_product: "whatsapp",
      metadata: { phone_number_id: "wa_acc_x" },
      messages: [{ from: "5511999" }],
    },
    ...over,
  };
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

  // env() é singleton lazy validado por Zod — setar ANTES de qualquer
  // import dinâmico que toque config/db/aead. NODE_ENV=test skips dotenv
  // E também desativa o onReady-bootstrap meta-api (server.ts §236) que
  // tentaria chamar o gateway real.
  process.env.NODE_ENV = "test";
  process.env.TEST_AUTH_BYPASS_ENABLED = "true";
  process.env.DATABASE_URL = dbUrl;
  process.env.REDIS_URL = redisUrl;
  process.env.STAFF_JWT_SECRET = "test-staff-jwt-secret-please-rotate-in-prod";
  // AEAD_MASTER_KEY tem que existir ANTES de encrypt() rodar em insertSubscription.
  // 32 bytes hex = 64 hex chars.
  process.env.AEAD_MASTER_KEY = "f".repeat(64);
  // Cliente meta-api carrega lazy mas seu env é lido na inicialização.
  process.env.META_API_BASE_URL = "http://test-meta-api.invalid";
  process.env.META_API_APP_ID = "test-app";
  process.env.META_API_KEY_ID = "test-key-id";
  // PEM dummy só para satisfazer optionalString (não usado em testes — onReady
  // skipa em NODE_ENV=test).
  process.env.META_API_PRIVATE_KEY_PEM = "dummy-pem-not-used-in-test";

  pool = new pg.Pool({ connectionString: dbUrl, max: 4 });
  await migrate(drizzle(pool), { migrationsFolder: "./db/migrations" });

  // Import dinâmico pós-env.
  const { buildServer } = await import("@/bootstrap/server.js");
  const { initDb } = await import("@/db/client.js");
  const uuidMod = await import("@/shared/uuid.js");
  const repoMod = await import("@/modules/channels/metaapi/repository.js");
  uuidv7 = uuidMod.uuidv7;

  await initDb();
  app = await buildServer();
  await app.ready();

  // Seed: subscription `active` com signing_secret AEAD-encrypted +
  // organization + mapping tenant→organization.
  await repoMod.insertSubscription({
    appId: "test-app-id",
    subscriptionId: uuidv7(),
    url: "http://test/api/v1/webhooks/metaapi/events",
    signingSecretPlaintext: SUB_SECRET,
  });

  orgId = uuidv7();
  await pool.query(
    `INSERT INTO organizations
       (id, name, business_name, niche, timezone, currency, locale)
     VALUES ($1,'Test Org M4P1','Test Org M4P1 LTDA','clinica','America/Sao_Paulo','BRL','pt-BR')`,
    [orgId],
  );
  await repoMod.insertTenantMapping({
    organizationId: orgId,
    metaApiTenantId: TENANT_ID,
  });
}, 180_000);

afterAll(async () => {
  await app?.close();
  const { closeDb } = await import("@/db/client.js");
  await closeDb();
  await pool?.end();
  await pgContainer?.stop();
  await redisContainer?.stop();
});

afterEach(async () => {
  // Limpa entre os testes — dedupe é Redis-based (TTL 24h) e usa
  // event_id fresh por chamada, então não precisa flush Redis aqui.
  await pool.query(`DELETE FROM received_events WHERE source = 'metaapi'`);
  await pool.query(`DELETE FROM audit_events WHERE entity_type = 'metaapi_event'`);
});

describe("POST /api/v1/webhooks/metaapi/events — full inbound flow", () => {
  it("(a) accepts verification challenge without HMAC", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/webhooks/metaapi/events",
      payload: JSON.stringify({ verification_challenge: "challenge-abc-123" }),
      headers: { "content-type": "application/json" },
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toEqual({ challenge: "challenge-abc-123" });
  });

  it("(b) accepts canonical event with valid HMAC and persists received_events", async () => {
    const envelope = makeEnvelope();
    const rawBody = JSON.stringify(envelope);
    const sig = sign(rawBody);

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/webhooks/metaapi/events",
      payload: rawBody,
      headers: { "content-type": "application/json", "x-bevox-signature": sig },
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ status: "accepted", event_id: envelope.event_id });

    const rows = await pool.query<{
      source: string;
      source_event_key: string;
      event_type: string;
      signature_valid: boolean;
    }>(
      `SELECT source, source_event_key, event_type, signature_valid
         FROM received_events
        WHERE source = 'metaapi' AND source_event_key = $1`,
      [envelope.event_id],
    );
    expect(rows.rowCount).toBe(1);
    expect(rows.rows[0]!.event_type).toBe("message.received");
    expect(rows.rows[0]!.signature_valid).toBe(true);
  });

  it("(c) rejects HMAC mismatch with 401", async () => {
    const envelope = makeEnvelope();
    const rawBody = JSON.stringify(envelope);
    const badSig = sign(rawBody, "wrong-secret");

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/webhooks/metaapi/events",
      payload: rawBody,
      headers: { "content-type": "application/json", "x-bevox-signature": badSig },
    });
    expect(res.statusCode).toBe(401);
  });

  it("(d) dedupes replayed event with status=replayed", async () => {
    const envelope = makeEnvelope();
    const rawBody = JSON.stringify(envelope);
    const sig = sign(rawBody);

    const r1 = await app.inject({
      method: "POST",
      url: "/api/v1/webhooks/metaapi/events",
      payload: rawBody,
      headers: { "content-type": "application/json", "x-bevox-signature": sig },
    });
    expect(r1.statusCode, r1.body).toBe(200);
    expect(r1.json()).toMatchObject({ status: "accepted" });

    // Mesmo event_id, signing válido (HMAC novo mas sobre mesmo body) →
    // Redis SETNX detecta replay.
    const sig2 = sign(rawBody);
    const r2 = await app.inject({
      method: "POST",
      url: "/api/v1/webhooks/metaapi/events",
      payload: rawBody,
      headers: { "content-type": "application/json", "x-bevox-signature": sig2 },
    });
    expect(r2.statusCode, r2.body).toBe(200);
    expect(r2.json()).toMatchObject({ status: "replayed", event_id: envelope.event_id });
  });

  it("(e) returns 404 when tenant_id is not mapped to any organization", async () => {
    // tenant_id UUIDv7-shaped mas ausente em organization_meta_api_tenant.
    const unmappedTenant = uuidv7();
    const envelope = makeEnvelope({ tenant_id: unmappedTenant });
    const rawBody = JSON.stringify(envelope);
    const sig = sign(rawBody);

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/webhooks/metaapi/events",
      payload: rawBody,
      headers: { "content-type": "application/json", "x-bevox-signature": sig },
    });
    expect(res.statusCode).toBe(404);
  });

  it("(f) writes audit_events row with entity_type=metaapi_event on accepted", async () => {
    const envelope = makeEnvelope();
    const rawBody = JSON.stringify(envelope);
    const sig = sign(rawBody);

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/webhooks/metaapi/events",
      payload: rawBody,
      headers: { "content-type": "application/json", "x-bevox-signature": sig },
    });
    expect(res.statusCode, res.body).toBe(200);

    const rows = await pool.query<{
      entity_type: string;
      action: string;
      actor_type: string;
      entity_id: string;
      organization_id: string;
    }>(
      `SELECT entity_type, action, actor_type, entity_id, organization_id
         FROM audit_events
        WHERE entity_type = 'metaapi_event' AND entity_id = $1`,
      [envelope.event_id],
    );
    expect(rows.rowCount).toBe(1);
    expect(rows.rows[0]!.action).toBe("metaapi.event.accepted");
    expect(rows.rows[0]!.actor_type).toBe("system");
    expect(rows.rows[0]!.organization_id).toBe(orgId);
  });

  it("(g) message.received WA text → message_records row + channel_connections row + queue job (P4 dispatch plumbing)", async () => {
    // Fresh org + tenant mapping so the P4 dispatch chain runs on isolated
    // fixtures (não colide com TENANT_ID/orgId reusados em (b)–(f)).
    const p4OrgId = uuidv7();
    const p4TenantId = uuidv7();
    await pool.query(
      `INSERT INTO organizations
         (id, name, business_name, niche, timezone, currency, locale)
       VALUES ($1,'P4 Test Org','P4 Test Org LTDA','clinica','America/Sao_Paulo','BRL','pt-BR')`,
      [p4OrgId],
    );
    const repoMod = await import("@/modules/channels/metaapi/repository.js");
    await repoMod.insertTenantMapping({
      organizationId: p4OrgId,
      metaApiTenantId: p4TenantId,
    });

    const envelope = makeEnvelope({
      tenant_id: p4TenantId,
      data: {
        messaging_product: "whatsapp",
        metadata: { phone_number_id: "wa_phone_p4_xyz" },
        messages: [
          {
            id: "wamid.p4test",
            from: "5511988887777",
            timestamp: "1747746000",
            type: "text",
            text: { body: "olá P4" },
          },
        ],
        contacts: [{ wa_id: "5511988887777", profile: { name: "Cliente P4" } }],
      },
    });
    const rawBody = JSON.stringify(envelope);
    const sig = sign(rawBody);

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/webhooks/metaapi/events",
      payload: rawBody,
      headers: { "content-type": "application/json", "x-bevox-signature": sig },
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ status: "accepted", event_id: envelope.event_id });

    // received_events row exists (forensic).
    const rcvd = await pool.query<{ id: string }>(
      `SELECT id FROM received_events
        WHERE source = 'metaapi' AND source_event_key = $1`,
      [envelope.event_id],
    );
    expect(rcvd.rowCount).toBe(1);
    const receivedEventId = rcvd.rows[0]!.id;

    // audit_events row exists.
    const audit = await pool.query(
      `SELECT id FROM audit_events
        WHERE entity_type = 'metaapi_event' AND entity_id = $1`,
      [envelope.event_id],
    );
    expect(audit.rowCount).toBe(1);

    // channel_connections row auto-seeded by P4 plumbing (Agent #3 HIGH-1 fix).
    const chConn = await pool.query<{ id: string; status: string }>(
      `SELECT id, status FROM channel_connections
        WHERE organization_id = $1 AND provider = $2 AND external_account_id = $3`,
      [p4OrgId, "wa", "wa_phone_p4_xyz"],
    );
    expect(chConn.rowCount).toBe(1);
    expect(chConn.rows[0]!.status).toBe("connected");

    // message_records row written (P4 dispatch plumbing).
    const msgRec = await pool.query<{
      external_message_id: string;
      content_text: string;
      direction: string;
    }>(
      `SELECT external_message_id, content_text, direction FROM message_records
        WHERE received_event_id = $1`,
      [receivedEventId],
    );
    expect(msgRec.rowCount).toBe(1);
    expect(msgRec.rows[0]!.external_message_id).toBe("wamid.p4test");
    expect(msgRec.rows[0]!.content_text).toBe("olá P4");
    expect(msgRec.rows[0]!.direction).toBe("incoming");

    // bevox.ingestion.event queue has the job.
    const { getIngestionEventQueue } = await import("@/lib/queues.js");
    const queue = getIngestionEventQueue();
    const jobs = await queue.getJobs(["waiting", "delayed", "active"], 0, 100);
    const p4Job = jobs.find(
      (j) => (j.data as { received_event_id?: string }).received_event_id === receivedEventId,
    );
    expect(p4Job).toBeDefined();
    if (p4Job) {
      const data = p4Job.data as {
        conversation_key: string;
        organization_id: string;
        external_account_id: string;
      };
      expect(data.conversation_key).toBe("channel:wa:wa_phone_p4_xyz:5511988887777");
      expect(data.organization_id).toBe(p4OrgId);
      expect(data.external_account_id).toBe("wa_phone_p4_xyz");
    }
  });

  it("(h) message.received WA image (no text) → message_records row with content_text NULL + media_json populated (M5-P3c media-only no longer dropped)", async () => {
    const p3cOrgId = uuidv7();
    const p3cTenantId = uuidv7();
    await pool.query(
      `INSERT INTO organizations
         (id, name, business_name, niche, timezone, currency, locale)
       VALUES ($1,'P3c Test Org','P3c Test Org LTDA','clinica','America/Sao_Paulo','BRL','pt-BR')`,
      [p3cOrgId],
    );
    const repoMod = await import("@/modules/channels/metaapi/repository.js");
    await repoMod.insertTenantMapping({
      organizationId: p3cOrgId,
      metaApiTenantId: p3cTenantId,
    });

    const envelope = makeEnvelope({
      tenant_id: p3cTenantId,
      data: {
        messaging_product: "whatsapp",
        metadata: { phone_number_id: "wa_phone_p3c_img" },
        messages: [
          {
            id: "wamid.p3c.image",
            from: "5511977776666",
            timestamp: "1747746000",
            type: "image",
            image: { id: "media_key_img_p3c", mime_type: "image/jpeg", caption: "uma foto" },
          },
        ],
        contacts: [{ wa_id: "5511977776666", profile: { name: "Cliente Media" } }],
      },
    });
    const rawBody = JSON.stringify(envelope);
    const sig = sign(rawBody);

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/webhooks/metaapi/events",
      payload: rawBody,
      headers: { "content-type": "application/json", "x-bevox-signature": sig },
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ status: "accepted", event_id: envelope.event_id });

    const rcvd = await pool.query<{ id: string }>(
      `SELECT id FROM received_events
        WHERE source = 'metaapi' AND source_event_key = $1`,
      [envelope.event_id],
    );
    expect(rcvd.rowCount).toBe(1);
    const receivedEventId = rcvd.rows[0]!.id;

    // message_records row written with content_text NULL + media_json populated.
    const msgRec = await pool.query<{
      external_message_id: string;
      content_text: string | null;
      direction: string;
      media_json: Array<{ media_key: string; mime_type: string; caption: string | null }> | null;
    }>(
      `SELECT external_message_id, content_text, direction, media_json FROM message_records
        WHERE received_event_id = $1`,
      [receivedEventId],
    );
    expect(msgRec.rowCount).toBe(1);
    expect(msgRec.rows[0]!.external_message_id).toBe("wamid.p3c.image");
    expect(msgRec.rows[0]!.content_text).toBeNull();
    expect(msgRec.rows[0]!.direction).toBe("incoming");
    expect(msgRec.rows[0]!.media_json).toEqual([
      {
        media_key: "media_key_img_p3c",
        mime_type: "image/jpeg",
        filename: null,
        caption: "uma foto",
      },
    ]);
  });

  it("(i) message.received WA text → message_records row with content_text set + media_json NULL (text behavior unchanged)", async () => {
    const txtOrgId = uuidv7();
    const txtTenantId = uuidv7();
    await pool.query(
      `INSERT INTO organizations
         (id, name, business_name, niche, timezone, currency, locale)
       VALUES ($1,'P3c Text Org','P3c Text Org LTDA','clinica','America/Sao_Paulo','BRL','pt-BR')`,
      [txtOrgId],
    );
    const repoMod = await import("@/modules/channels/metaapi/repository.js");
    await repoMod.insertTenantMapping({
      organizationId: txtOrgId,
      metaApiTenantId: txtTenantId,
    });

    const envelope = makeEnvelope({
      tenant_id: txtTenantId,
      data: {
        messaging_product: "whatsapp",
        metadata: { phone_number_id: "wa_phone_p3c_txt" },
        messages: [
          {
            id: "wamid.p3c.text",
            from: "5511966665555",
            timestamp: "1747746000",
            type: "text",
            text: { body: "olá texto" },
          },
        ],
        contacts: [{ wa_id: "5511966665555", profile: { name: "Cliente Texto" } }],
      },
    });
    const rawBody = JSON.stringify(envelope);
    const sig = sign(rawBody);

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/webhooks/metaapi/events",
      payload: rawBody,
      headers: { "content-type": "application/json", "x-bevox-signature": sig },
    });
    expect(res.statusCode, res.body).toBe(200);

    const rcvd = await pool.query<{ id: string }>(
      `SELECT id FROM received_events
        WHERE source = 'metaapi' AND source_event_key = $1`,
      [envelope.event_id],
    );
    expect(rcvd.rowCount).toBe(1);
    const receivedEventId = rcvd.rows[0]!.id;

    const msgRec = await pool.query<{
      content_text: string | null;
      media_json: unknown | null;
    }>(
      `SELECT content_text, media_json FROM message_records
        WHERE received_event_id = $1`,
      [receivedEventId],
    );
    expect(msgRec.rowCount).toBe(1);
    expect(msgRec.rows[0]!.content_text).toBe("olá texto");
    expect(msgRec.rows[0]!.media_json).toBeNull();
  });
});
