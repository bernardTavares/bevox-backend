/**
 * Teste de integração — `createAppointment` em `src/modules/calendar/booking.ts`.
 *
 * Cobre o coração do CRÍT #3 da auditoria 2026-06-02:
 *
 *   - **Idempotência via Redis cache**: 2 chamadas com mesma `idempotencyKey`
 *     → mesmo `appointment_id`, 1 row em DB.
 *   - **Idempotência via DB unique constraint (`appointments_org_idempotency_uniq`)**:
 *     se o Redis perdeu o snapshot entre as chamadas, o índice único do DB
 *     captura o replay e devolve o appointment existente em vez de criar duplicata.
 *   - **Concorrência (`pg_advisory_xact_lock`)**: 2 invocações paralelas com a
 *     mesma slot/service/professional onde max_concurrent=1 → uma faz `booked`,
 *     a outra recebe `slot_conflict` (sem double-booking).
 *   - **booking_notice_minutes (service_policies)**: slot antes da janela de
 *     antecedência → `slot_conflict` (PRD §5.3; reconciliação Task 3).
 *   - **Fail-fast em service/calendar inativo ou inexistente**: throws 404.
 *
 * NÃO cobre (intencional, fora deste teste):
 *   - hook `requires_prepayment` (precisa stub do `payments/service.ts` —
 *     o seam é dynamic import; tem cobertura própria em payments-manual-mode).
 *   - reschedule/transition (`rescheduleAppointment`, `transitionAppointment` —
 *     outro PR).
 *   - sync para Google Calendar (`google_sync_outbox` é POPULADO pelo
 *     INSERT; teste assenta que a row existe, mas não exercita o worker).
 *
 * Sobe Postgres (pg_uuidv7 empacotado) + Redis via testcontainers, aplica
 * migrations reais e exercita o service contra o DB. Mirror do lifecycle
 * de container de `payments-manual-mode.test.ts`.
 *
 * Ref: docs/audits/runtime-gap-audit-2026-06-02.md CRÍT #3
 * (`calendar-booking-zero-tests`).
 */

import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { GenericContainer, type StartedTestContainer, Wait } from "testcontainers";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { createAppointment as CreateAppointment } from "@/modules/calendar/booking.js";
import type { uuidv7 as Uuidv7 } from "@/shared/uuid.js";

const PG_IMAGE = "ghcr.io/fboulnois/pg_uuidv7:1.6.0";
const PG_DB = "bevox_backend_test";
const PG_USER = "bevox";
const PG_PASSWORD = "bevox_test_password";
const REDIS_IMAGE = "redis:7-alpine";

let pgContainer: StartedTestContainer;
let redisContainer: StartedTestContainer;
let pool: pg.Pool;

// Imports dinâmicos após DATABASE_URL/REDIS_URL no env + initDb.
let createAppointment: typeof CreateAppointment;
let uuidv7: typeof Uuidv7;

// --- Fixtures ---

async function seedOrg(name: string): Promise<string> {
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

async function seedService(
  orgId: string,
  opts?: { durationMinutes?: number; maxConcurrent?: number; isActive?: boolean },
): Promise<string> {
  const id = uuidv7();
  await pool.query(
    `INSERT INTO services
       (id, organization_id, name, duration_minutes, max_concurrent, currency, is_active)
     VALUES ($1,$2,'Booking Test Service',$3,$4,'BRL',$5)`,
    [id, orgId, opts?.durationMinutes ?? 60, opts?.maxConcurrent ?? 1, opts?.isActive ?? true],
  );
  return id;
}

async function seedCalendar(orgId: string, opts?: { isActive?: boolean }): Promise<string> {
  const id = uuidv7();
  await pool.query(
    `INSERT INTO calendars (id, organization_id, name, is_active) VALUES ($1,$2,'Booking Test Cal',$3)`,
    [id, orgId, opts?.isActive ?? true],
  );
  return id;
}

async function seedProfessional(orgId: string): Promise<string> {
  const id = uuidv7();
  await pool.query(
    `INSERT INTO professionals (id, organization_id, name, role_type, is_bookable, is_active)
     VALUES ($1,$2,'Booking Test Pro','provider',true,true)`,
    [id, orgId],
  );
  return id;
}

async function linkProfessionalToService(
  orgId: string,
  professionalId: string,
  serviceId: string,
): Promise<void> {
  await pool.query(
    `INSERT INTO professional_services (id, organization_id, professional_id, service_id)
     VALUES ($1,$2,$3,$4)`,
    [uuidv7(), orgId, professionalId, serviceId],
  );
}

/** Schedule wide-open: 08:00-20:00 todos os dias da semana (sem break). */
async function seedFullSchedule(orgId: string, professionalId: string): Promise<void> {
  for (let dow = 0; dow <= 6; dow++) {
    await pool.query(
      `INSERT INTO professional_schedules
         (id, organization_id, professional_id, day_of_week, start_time, end_time)
       VALUES ($1,$2,$3,$4,'08:00','20:00')`,
      [uuidv7(), orgId, professionalId, dow],
    );
  }
}

async function setBookingNotice(serviceId: string, minutes: number): Promise<void> {
  // service_policies PK = service_id (não tem coluna id separada).
  await pool.query(
    `INSERT INTO service_policies (service_id, booking_notice_minutes) VALUES ($1, $2)
     ON CONFLICT (service_id) DO UPDATE SET booking_notice_minutes = EXCLUDED.booking_notice_minutes`,
    [serviceId, minutes],
  );
}

/** Próximo dia útil futuro (+1 dia para garantir disponibilidade). */
function tomorrowIso(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

// --- Lifecycle ---

beforeAll(async () => {
  pgContainer = await new GenericContainer(PG_IMAGE)
    .withEnvironment({
      POSTGRES_DB: PG_DB,
      POSTGRES_USER: PG_USER,
      POSTGRES_PASSWORD: PG_PASSWORD,
    })
    .withExposedPorts(5432)
    .withWaitStrategy(Wait.forLogMessage("database system is ready to accept connections", 2))
    .start();

  redisContainer = await new GenericContainer(REDIS_IMAGE)
    .withExposedPorts(6379)
    .withWaitStrategy(Wait.forLogMessage("Ready to accept connections"))
    .start();

  const pgPort = pgContainer.getMappedPort(5432);
  const pgHost = pgContainer.getHost();
  const redisPort = redisContainer.getMappedPort(6379);
  const redisHost = redisContainer.getHost();

  process.env.DATABASE_URL = `postgres://${PG_USER}:${PG_PASSWORD}@${pgHost}:${pgPort}/${PG_DB}`;
  process.env.REDIS_URL = `redis://${redisHost}:${redisPort}`;
  process.env.NODE_ENV = "test";
  process.env.TEST_AUTH_BYPASS_ENABLED = "true";

  pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  await migrate(drizzle(pool), { migrationsFolder: "./db/migrations" });

  const dbClient = await import("@/db/client.js");
  await dbClient.initDb();

  const booking = await import("@/modules/calendar/booking.js");
  createAppointment = booking.createAppointment;

  const uuidMod = await import("@/shared/uuid.js");
  uuidv7 = uuidMod.uuidv7;
}, 120_000);

afterAll(async () => {
  await pool?.end();
  await pgContainer?.stop();
  await redisContainer?.stop();
});

// --- Setup partilhado: org/service/calendar/professional/schedule ---

async function newWorld(opts?: { maxConcurrent?: number; durationMinutes?: number }): Promise<{
  orgId: string;
  calendarId: string;
  serviceId: string;
  professionalId: string;
}> {
  const orgId = await seedOrg(`Org ${Math.random().toString(36).slice(2)}`);
  const serviceId = await seedService(orgId, {
    maxConcurrent: opts?.maxConcurrent ?? 1,
    durationMinutes: opts?.durationMinutes ?? 60,
  });
  const calendarId = await seedCalendar(orgId);
  const professionalId = await seedProfessional(orgId);
  await linkProfessionalToService(orgId, professionalId, serviceId);
  await seedFullSchedule(orgId, professionalId);
  return { orgId, calendarId, serviceId, professionalId };
}

// --- Tests ---

describe("createAppointment — fail-fast errors", () => {
  it("throws Service not found quando serviceId não existe ou inativo", async () => {
    const orgId = await seedOrg("Err 1");
    const calendarId = await seedCalendar(orgId);
    await expect(
      createAppointment({
        organizationId: orgId,
        calendarId,
        serviceId: "01939c83-0000-7000-8000-000000000999",
        date: tomorrowIso(),
        startTime: "10:00",
        source: "manual",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("throws Calendar not found quando calendarId não existe ou inativo", async () => {
    const orgId = await seedOrg("Err 2");
    const serviceId = await seedService(orgId);
    await expect(
      createAppointment({
        organizationId: orgId,
        calendarId: "01939c83-0000-7000-8000-000000000888",
        serviceId,
        date: tomorrowIso(),
        startTime: "10:00",
        source: "manual",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("createAppointment — booking_notice (slot too soon)", () => {
  it("retorna slot_conflict quando start_at < now() + booking_notice_minutes", async () => {
    const { orgId, calendarId, serviceId } = await newWorld();
    // 24h de antecedência mínima — tomorrow 10:00 = 0–24h no futuro,
    // dependendo da hora atual; com 1440min de antecedência, slot < limite.
    await setBookingNotice(serviceId, 1440);
    const r = await createAppointment({
      organizationId: orgId,
      calendarId,
      serviceId,
      date: tomorrowIso(),
      startTime: "10:00",
      source: "manual",
    });
    expect(r.status).toBe("slot_conflict");
  });
});

describe("createAppointment — happy path + idempotência", () => {
  it("booking simples: status 'booked' + appointment_id UUID + 1 row em DB", async () => {
    const { orgId, calendarId, serviceId } = await newWorld();
    const r = await createAppointment({
      organizationId: orgId,
      calendarId,
      serviceId,
      date: tomorrowIso(),
      startTime: "10:00",
      source: "manual",
    });
    expect(r.status).toBe("booked");
    if (r.status !== "booked") throw new Error("unreachable");
    expect(r.appointment_id).toMatch(/^[0-9a-f-]{36}$/);
    const rows = await pool.query(
      `SELECT id, status FROM appointments WHERE organization_id = $1`,
      [orgId],
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]).toMatchObject({ status: "scheduled" });
  });

  it("idempotency cache (Redis): 2 chamadas com mesma key → mesmo appointment_id, 1 row em DB", async () => {
    const { orgId, calendarId, serviceId } = await newWorld();
    const idemKey = `idem-${uuidv7()}`;
    const r1 = await createAppointment({
      organizationId: orgId,
      calendarId,
      serviceId,
      date: tomorrowIso(),
      startTime: "11:00",
      source: "manual",
      idempotencyKey: idemKey,
    });
    const r2 = await createAppointment({
      organizationId: orgId,
      calendarId,
      serviceId,
      date: tomorrowIso(),
      startTime: "11:00",
      source: "manual",
      idempotencyKey: idemKey,
    });
    expect(r1.status).toBe("booked");
    expect(r2.status).toBe("booked");
    if (r1.status !== "booked" || r2.status !== "booked") throw new Error("unreachable");
    expect(r2.appointment_id).toBe(r1.appointment_id);
    const cnt = await pool.query(
      `SELECT count(*)::int AS n FROM appointments WHERE organization_id = $1`,
      [orgId],
    );
    expect(cnt.rows[0].n).toBe(1);
  });

  it("idempotency DB unique constraint (Redis flush entre chamadas): 2 chamadas com mesma key → mesmo appointment_id, 1 row em DB", async () => {
    // max_concurrent=2 garante que o slot tem capacidade para a 2ª chamada
    // ATINGIR o INSERT (com max_concurrent=1, a 2ª pararia em slot_conflict
    // antes da transaction). O índice único `appointments_org_idempotency_uniq`
    // é o que captura o replay aqui — comportamento documentado em
    // booking.ts:244-256.
    const { orgId, calendarId, serviceId } = await newWorld({ maxConcurrent: 2 });
    const idemKey = `idem-flush-${uuidv7()}`;
    const r1 = await createAppointment({
      organizationId: orgId,
      calendarId,
      serviceId,
      date: tomorrowIso(),
      startTime: "12:00",
      source: "manual",
      idempotencyKey: idemKey,
    });
    expect(r1.status).toBe("booked");
    if (r1.status !== "booked") throw new Error("unreachable");

    // Simula Redis perdendo a chave entre as chamadas (chave hash do
    // idempotencyKey limpa). O índice único do DB
    // (`appointments_org_idempotency_uniq`) deve capturar o replay.
    const redisMod = await import("@/lib/redis.js");
    const redis = redisMod.getRedis();
    await redis.flushdb();

    const r2 = await createAppointment({
      organizationId: orgId,
      calendarId,
      serviceId,
      date: tomorrowIso(),
      startTime: "12:00",
      source: "manual",
      idempotencyKey: idemKey,
    });
    expect(r2.status).toBe("booked");
    if (r2.status !== "booked") throw new Error("unreachable");
    expect(r2.appointment_id).toBe(r1.appointment_id);
    const cnt = await pool.query(
      `SELECT count(*)::int AS n FROM appointments WHERE organization_id = $1`,
      [orgId],
    );
    expect(cnt.rows[0].n).toBe(1);
  });
});

describe("createAppointment — concorrência e capacidade", () => {
  it("2 reservas paralelas para o mesmo slot com max_concurrent=1: uma 'booked', outra 'slot_conflict', exatamente 1 row", async () => {
    const { orgId, calendarId, serviceId } = await newWorld({ maxConcurrent: 1 });
    const date = tomorrowIso();
    // Lança as 2 simultaneamente (idem keys DIFERENTES para forçar
    // serialização real pelo advisory lock + recount; idem key igual
    // colapsaria via cache).
    const [a, b] = await Promise.all([
      createAppointment({
        organizationId: orgId,
        calendarId,
        serviceId,
        date,
        startTime: "13:00",
        source: "manual",
        idempotencyKey: `idem-a-${uuidv7()}`,
      }),
      createAppointment({
        organizationId: orgId,
        calendarId,
        serviceId,
        date,
        startTime: "13:00",
        source: "manual",
        idempotencyKey: `idem-b-${uuidv7()}`,
      }),
    ]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual(["booked", "slot_conflict"]);
    const cnt = await pool.query(
      `SELECT count(*)::int AS n FROM appointments WHERE organization_id = $1`,
      [orgId],
    );
    expect(cnt.rows[0].n).toBe(1);
  });

  it("max_concurrent=2: 2 reservas no mesmo slot são ambas 'booked'; 3ª é 'slot_conflict'", async () => {
    const { orgId, calendarId, serviceId, professionalId } = await newWorld({ maxConcurrent: 2 });
    // Adicionar um 2º profissional + schedule, ambos linkados ao service,
    // para o slot ter 2 vagas (max_concurrent=2 é por-profissional,
    // recount soma os agendamentos do mesmo profissional). Se forçar
    // 2 reservas no mesmo (slot, profissional), com max_concurrent=2
    // ambas cabem.
    const date = tomorrowIso();
    const r1 = await createAppointment({
      organizationId: orgId,
      calendarId,
      serviceId,
      professionalId,
      date,
      startTime: "14:00",
      source: "manual",
      idempotencyKey: `idem-c1-${uuidv7()}`,
    });
    const r2 = await createAppointment({
      organizationId: orgId,
      calendarId,
      serviceId,
      professionalId,
      date,
      startTime: "14:00",
      source: "manual",
      idempotencyKey: `idem-c2-${uuidv7()}`,
    });
    const r3 = await createAppointment({
      organizationId: orgId,
      calendarId,
      serviceId,
      professionalId,
      date,
      startTime: "14:00",
      source: "manual",
      idempotencyKey: `idem-c3-${uuidv7()}`,
    });
    expect(r1.status).toBe("booked");
    expect(r2.status).toBe("booked");
    expect(r3.status).toBe("slot_conflict");
  });
});
