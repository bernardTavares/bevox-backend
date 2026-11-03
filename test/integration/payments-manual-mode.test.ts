/**
 * Teste de integração — Manual Payment Mode (M5-P4 Task 6).
 *
 * Cobre `createManualCharge` (cria charge `pending` SEM Stripe call) +
 * `getManualAccount` + o padrão "actor audit":
 *   (a) full charge → status 'pending', payment_method, provider_charge_id
 *       NULL, amount_platform_fee NULL, payment_account_id = a conta manual;
 *       audit_events com action='charge.created_manual', actor_type='user',
 *       actor_id = o users.id (uuid) RESOLVIDO a partir do clerk_user_id, e
 *       after_json.actor_clerk_user_id = o clerk id original;
 *   (b) charge_type='package' sem service_package_id → guard do service lança
 *       invalidInput (mesmo passando o input diretamente, bypass da rota);
 *   (c) org sem conta manual → invalidInput "manual payment account not
 *       configured".
 *
 * Sobe Postgres (pg_uuidv7 empacotado) + Redis via testcontainers, aplica
 * migrations, e exercita o service real contra o DB. Mirror do lifecycle de
 * container de organizations-crud.test.ts (sem helper compartilhado).
 *
 * NOTA: audit_events.actor_id é coluna `uuid`; o ator na rota é o
 * clerk_user_id (id Clerk `user_...`, NÃO uuid). createManualCharge resolve
 * clerk_user_id → users.id (getUserIdByClerkId) e grava o uuid em actor_id;
 * o clerk id original sobrevive em after_json.actor_clerk_user_id.
 */

import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { GenericContainer, type StartedTestContainer, Wait } from "testcontainers";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type {
  connectManualAccount as ConnectManualAccount,
  createManualCharge as CreateManualCharge,
  expireChargeManually as ExpireChargeManually,
  markChargePaidManually as MarkChargePaidManually,
  refundChargeManually as RefundChargeManually,
} from "@/modules/payments/service.js";
import type { uuidv7 as Uuidv7 } from "@/shared/uuid.js";

const PG_IMAGE = "ghcr.io/fboulnois/pg_uuidv7:1.6.0";
const PG_DB = "bevox_backend_test";
const PG_USER = "bevox";
const PG_PASSWORD = "bevox_test_password";
const REDIS_IMAGE = "redis:7-alpine";

let pgContainer: StartedTestContainer;
let redisContainer: StartedTestContainer;
let pool: pg.Pool;

// Importado dinamicamente após DATABASE_URL/REDIS_URL estarem no env + initDb.
let createManualCharge: typeof CreateManualCharge;
let markChargePaidManually: typeof MarkChargePaidManually;
let refundChargeManually: typeof RefundChargeManually;
let expireChargeManually: typeof ExpireChargeManually;
let connectManualAccount: typeof ConnectManualAccount;
let uuidv7: typeof Uuidv7;

let orgWithManual: string; // org com conta manual configurada
let orgNoManual: string; // org SEM conta manual
let customerId: string;
let manualAccountId: string;
let seededUserId: string; // users.id (uuid) esperado em audit_events.actor_id
// Ator na rota = clerk_user_id (id Clerk, NÃO uuid) — prova que a resolução
// clerk_user_id → users.id funciona.
const clerkUserId = "user_test_1";

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

async function seedCustomer(orgId: string, fullName: string): Promise<string> {
  const id = uuidv7();
  await pool.query(`INSERT INTO customers (id, organization_id, full_name) VALUES ($1,$2,$3)`, [
    id,
    orgId,
    fullName,
  ]);
  return id;
}

async function seedManualAccount(orgId: string): Promise<string> {
  const id = uuidv7();
  await pool.query(
    `INSERT INTO payment_accounts
       (id, organization_id, provider, account_holder_type, onboarding_status, charges_enabled)
     VALUES ($1,$2,'manual','organization','active',true)`,
    [id, orgId],
  );
  return id;
}

/** Seed um users row org-scoped; retorna o users.id (uuid) gerado. */
async function seedUser(orgId: string, clerk: string): Promise<string> {
  const id = uuidv7();
  await pool.query(
    `INSERT INTO users (id, organization_id, name, role, clerk_user_id)
     VALUES ($1,$2,$3,'owner',$4)`,
    [id, orgId, "Owner Manual", clerk],
  );
  return id;
}

/** Seed um service_package ativo org-scoped; retorna o service_packages.id. */
async function seedServicePackage(
  orgId: string,
  opts?: { sessionsIncluded?: number; validityDays?: number | null },
): Promise<string> {
  const id = uuidv7();
  await pool.query(
    `INSERT INTO service_packages
       (id, organization_id, name, sessions_included, price_amount, validity_days, is_active)
     VALUES ($1,$2,'Pacote Manual',$3,'300.00',$4,true)`,
    [id, orgId, opts?.sessionsIncluded ?? 5, opts?.validityDays ?? null],
  );
  return id;
}

/** Seed um service org-scoped; retorna services.id. */
async function seedService(orgId: string): Promise<string> {
  const id = uuidv7();
  await pool.query(
    `INSERT INTO services (id, organization_id, name, duration_minutes, currency)
     VALUES ($1,$2,'Serviço Manual',60,'BRL')`,
    [id, orgId],
  );
  return id;
}

/** Seed um professional org-scoped; retorna professionals.id. */
async function seedProfessional(orgId: string): Promise<string> {
  const id = uuidv7();
  await pool.query(
    `INSERT INTO professionals (id, organization_id, name, role_type)
     VALUES ($1,$2,'Profissional Manual','provider')`,
    [id, orgId],
  );
  return id;
}

/** Seed um calendar org-scoped; retorna calendars.id. */
async function seedCalendar(orgId: string): Promise<string> {
  const id = uuidv7();
  await pool.query(
    `INSERT INTO calendars (id, organization_id, name) VALUES ($1,$2,'Agenda Manual')`,
    [id, orgId],
  );
  return id;
}

/**
 * Seed um appointment org-scoped no estado 'scheduled' (não-confirmado);
 * retorna appointments.id. start_at/end_at no futuro (range_check end>start).
 */
async function seedAppointment(
  orgId: string,
  refs: { calendarId: string; serviceId: string; professionalId: string; customerId: string },
): Promise<string> {
  const id = uuidv7();
  await pool.query(
    `INSERT INTO appointments
       (id, organization_id, calendar_id, service_id, professional_id, customer_id,
        start_at, end_at, status, source)
     VALUES ($1,$2,$3,$4,$5,$6,
             now() + interval '1 day', now() + interval '1 day' + interval '1 hour',
             'scheduled','manual')`,
    [id, orgId, refs.calendarId, refs.serviceId, refs.professionalId, refs.customerId],
  );
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
  process.env.TEST_AUTH_BYPASS_ENABLED = "true";
  process.env.DATABASE_URL = dbUrl;
  process.env.REDIS_URL = redisUrl;
  process.env.STAFF_JWT_SECRET = "test-staff-jwt-secret-please-rotate-in-prod";

  pool = new pg.Pool({ connectionString: dbUrl, max: 4 });
  await migrate(drizzle(pool), { migrationsFolder: "./db/migrations" });

  const { initDb } = await import("@/db/client.js");
  await initDb();
  ({
    createManualCharge,
    markChargePaidManually,
    refundChargeManually,
    expireChargeManually,
    connectManualAccount,
  } = await import("@/modules/payments/service.js"));
  ({ uuidv7 } = await import("@/shared/uuid.js"));

  orgWithManual = await seedOrg("Manual Org");
  orgNoManual = await seedOrg("Stripe Only Org");
  customerId = await seedCustomer(orgWithManual, "Cliente Manual");
  manualAccountId = await seedManualAccount(orgWithManual);
  seededUserId = await seedUser(orgWithManual, clerkUserId);
}, 180_000);

afterAll(async () => {
  const { closeDb } = await import("@/db/client.js");
  await closeDb();
  await pool?.end();
  await pgContainer?.stop();
  await redisContainer?.stop();
});

describe("createManualCharge (M5-P4 Manual Payment Mode)", () => {
  it("(a) full charge → pending, no Stripe, audit charge.created_manual", async () => {
    const res = await createManualCharge(
      orgWithManual,
      {
        customer_id: customerId,
        amount_total: 120.5,
        charge_type: "full",
        currency: "BRL",
        payment_method: "cash",
      },
      "idem-key-1",
      { clerkUserId },
    );
    expect(res.status).toBe("pending");
    expect(res.charge_id).toBeTruthy();

    const chargeRow = await pool.query<{
      status: string;
      payment_method: string | null;
      provider_charge_id: string | null;
      amount_platform_fee: string | null;
      amount_total: string;
      payment_account_id: string;
      currency: string;
    }>(
      `SELECT status, payment_method, provider_charge_id, amount_platform_fee,
              amount_total, payment_account_id, currency
         FROM charges WHERE id = $1 AND organization_id = $2`,
      [res.charge_id, orgWithManual],
    );
    const charge = chargeRow.rows[0]!;
    expect(charge.status).toBe("pending");
    expect(charge.payment_method).toBe("cash");
    expect(charge.provider_charge_id).toBeNull();
    expect(charge.amount_platform_fee).toBeNull();
    expect(charge.payment_account_id).toBe(manualAccountId);
    expect(Number(charge.amount_total)).toBe(120.5);
    expect(charge.currency).toBe("BRL");

    const audit = await pool.query<{
      action: string;
      actor_type: string;
      actor_id: string | null;
      actor_clerk_user_id: string | null;
    }>(
      `SELECT action, actor_type, actor_id,
              after_json->>'actor_clerk_user_id' AS actor_clerk_user_id
         FROM audit_events
        WHERE organization_id = $1 AND entity_type = 'charge' AND entity_id = $2
          AND action = 'charge.created_manual'`,
      [orgWithManual, res.charge_id],
    );
    expect(audit.rows.length).toBe(1);
    expect(audit.rows[0]!.actor_type).toBe("user");
    // actor_id = users.id (uuid) RESOLVIDO do clerk_user_id (não o clerk id).
    expect(audit.rows[0]!.actor_id).toBe(seededUserId);
    // O clerk id original sobrevive no after_json.
    expect(audit.rows[0]!.actor_clerk_user_id).toBe(clerkUserId);
  });

  it("(b) package charge without service_package_id → invalidInput (service guard)", async () => {
    await expect(
      createManualCharge(
        orgWithManual,
        {
          customer_id: customerId,
          amount_total: 200,
          charge_type: "package",
          currency: "BRL",
          // service_package_id intentionally omitted to hit the service guard
        },
        "idem-key-pkg-missing",
        { clerkUserId },
      ),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("(c) org without manual account → invalidInput 'manual payment account not configured'", async () => {
    const noCustomer = await seedCustomer(orgNoManual, "Cliente Sem Conta");
    await expect(
      createManualCharge(
        orgNoManual,
        {
          customer_id: noCustomer,
          amount_total: 50,
          charge_type: "full",
          currency: "BRL",
          payment_method: "cash",
        },
        "idem-key-no-account",
        { clerkUserId },
      ),
    ).rejects.toMatchObject({
      code: "INVALID_INPUT",
      message: "manual payment account not configured",
    });
  });
});

describe("markChargePaidManually (M5-P4 Task 7)", () => {
  const PAID_AT = "2026-05-22T10:00:00.000Z";

  it("(a) full lifecycle → paid + exactly ONE payment (manual:<id>) + audit", async () => {
    const created = await createManualCharge(
      orgWithManual,
      {
        customer_id: customerId,
        amount_total: 80.0,
        charge_type: "full",
        currency: "BRL",
        payment_method: "cash",
      },
      "idem-mark-full",
      { clerkUserId },
    );
    const chargeId = created.charge_id;

    const res = await markChargePaidManually(
      orgWithManual,
      chargeId,
      {
        paid_at: PAID_AT,
        payment_method: "cash",
        reference: "REC-001",
        reason: "recebido em caixa",
      },
      { clerkUserId },
    );
    expect(res.status).toBe("paid");
    expect(res.charge_id).toBe(chargeId);

    const charge = await pool.query<{ status: string; paid_at: string | null }>(
      `SELECT status, paid_at FROM charges WHERE id = $1 AND organization_id = $2`,
      [chargeId, orgWithManual],
    );
    expect(charge.rows[0]!.status).toBe("paid");
    expect(charge.rows[0]!.paid_at).not.toBeNull();

    // EXACTLY ONE payment row, deterministic provider_payment_id, status paid.
    const payments = await pool.query<{
      provider_payment_id: string;
      status: string;
      amount_paid: string;
    }>(
      `SELECT provider_payment_id, status, amount_paid
         FROM payments WHERE organization_id = $1 AND charge_id = $2`,
      [orgWithManual, chargeId],
    );
    expect(payments.rows.length).toBe(1);
    expect(payments.rows[0]!.provider_payment_id).toBe(`manual:${chargeId}`);
    expect(payments.rows[0]!.status).toBe("paid");
    expect(Number(payments.rows[0]!.amount_paid)).toBe(80.0);

    const audit = await pool.query<{
      action: string;
      actor_type: string;
      actor_id: string | null;
      reason_text: string | null;
    }>(
      `SELECT action, actor_type, actor_id, reason_text
         FROM audit_events
        WHERE organization_id = $1 AND entity_type = 'charge' AND entity_id = $2
          AND action = 'charge.marked_paid_manual'`,
      [orgWithManual, chargeId],
    );
    expect(audit.rows.length).toBe(1);
    expect(audit.rows[0]!.actor_type).toBe("user");
    // actor_id = users.id (uuid) RESOLVIDO do clerk_user_id.
    expect(audit.rows[0]!.actor_id).toBe(seededUserId);
    expect(audit.rows[0]!.reason_text).toBe("recebido em caixa");
  });

  it("(b) package charge → grants exactly one customer_package", async () => {
    const spId = await seedServicePackage(orgWithManual, { sessionsIncluded: 5, validityDays: 30 });
    const created = await createManualCharge(
      orgWithManual,
      {
        customer_id: customerId,
        amount_total: 300.0,
        charge_type: "package",
        service_package_id: spId,
        currency: "BRL",
        payment_method: "pix_manual",
      },
      "idem-mark-pkg",
      { clerkUserId },
    );
    const chargeId = created.charge_id;

    await markChargePaidManually(
      orgWithManual,
      chargeId,
      { paid_at: PAID_AT, payment_method: "pix_manual", reason: "pacote pago" },
      { clerkUserId },
    );

    const cps = await pool.query<{
      service_package_id: string;
      status: string;
      sessions_total: number;
    }>(
      `SELECT service_package_id, status, sessions_total
         FROM customer_packages WHERE organization_id = $1 AND charge_id = $2`,
      [orgWithManual, chargeId],
    );
    expect(cps.rows.length).toBe(1);
    expect(cps.rows[0]!.service_package_id).toBe(spId);
    expect(cps.rows[0]!.status).toBe("active");
    expect(cps.rows[0]!.sessions_total).toBe(5);
  });

  it("(c) double-submit idempotent → ONE payment + ONE customer_package, stays paid", async () => {
    const spId = await seedServicePackage(orgWithManual, {
      sessionsIncluded: 3,
      validityDays: null,
    });
    const created = await createManualCharge(
      orgWithManual,
      {
        customer_id: customerId,
        amount_total: 150.0,
        charge_type: "package",
        service_package_id: spId,
        currency: "BRL",
        payment_method: "bank_transfer",
      },
      "idem-mark-double",
      { clerkUserId },
    );
    const chargeId = created.charge_id;

    const markInput = {
      paid_at: PAID_AT,
      payment_method: "bank_transfer" as const,
      reason: "transferência confirmada",
    };
    // Marca DUAS vezes — a 2ª é um re-mark legítimo idempotente.
    await markChargePaidManually(orgWithManual, chargeId, markInput, { clerkUserId });
    const second = await markChargePaidManually(orgWithManual, chargeId, markInput, {
      clerkUserId,
    });
    expect(second.status).toBe("paid");

    // Idempotência por construção (provider_payment_id determinístico +
    // ON CONFLICT): exactly-one payment row mesmo após 2 marks.
    const payments = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM payments
        WHERE organization_id = $1 AND charge_id = $2 AND provider_payment_id = $3`,
      [orgWithManual, chargeId, `manual:${chargeId}`],
    );
    expect(payments.rows[0]!.count).toBe("1");

    // Grant insert-once (customer_packages_charge_uniq): exactly-one package.
    const cps = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM customer_packages
        WHERE organization_id = $1 AND charge_id = $2`,
      [orgWithManual, chargeId],
    );
    expect(cps.rows[0]!.count).toBe("1");

    const charge = await pool.query<{ status: string }>(
      `SELECT status FROM charges WHERE id = $1 AND organization_id = $2`,
      [chargeId, orgWithManual],
    );
    expect(charge.rows[0]!.status).toBe("paid");
  });

  it("(d) appointment confirm → linked unconfirmed appointment becomes confirmed", async () => {
    const calendarId = await seedCalendar(orgWithManual);
    const serviceId = await seedService(orgWithManual);
    const professionalId = await seedProfessional(orgWithManual);
    const appointmentId = await seedAppointment(orgWithManual, {
      calendarId,
      serviceId,
      professionalId,
      customerId,
    });

    const created = await createManualCharge(
      orgWithManual,
      {
        customer_id: customerId,
        appointment_id: appointmentId,
        amount_total: 90.0,
        charge_type: "full",
        currency: "BRL",
        payment_method: "cash",
      },
      "idem-mark-appt",
      { clerkUserId },
    );

    await markChargePaidManually(
      orgWithManual,
      created.charge_id,
      { paid_at: PAID_AT, payment_method: "cash", reason: "pago no balcão" },
      { clerkUserId },
    );

    // confirmAppointmentIfUnconfirmed transiciona status 'scheduled' →
    // 'confirmed' (canon §8.4 step 10), espelhando transitionAppointment.
    const appt = await pool.query<{ status: string }>(
      `SELECT status FROM appointments WHERE id = $1 AND organization_id = $2`,
      [appointmentId, orgWithManual],
    );
    expect(appt.rows[0]!.status).toBe("confirmed");
  });

  it("(e) not a manual charge → invalidInput", async () => {
    // Charge numa conta NÃO-manual (Stripe org account) → guard rejeita.
    const stripeAcctId = uuidv7();
    await pool.query(
      `INSERT INTO payment_accounts
         (id, organization_id, provider, account_holder_type, onboarding_status, charges_enabled,
          external_account_id)
       VALUES ($1,$2,'stripe','organization','active',true,'acct_test_stripe')`,
      [stripeAcctId, orgNoManual],
    );
    const stripeCustomer = await seedCustomer(orgNoManual, "Cliente Stripe");
    const chargeId = uuidv7();
    await pool.query(
      `INSERT INTO charges
         (id, organization_id, customer_id, payment_account_id, charge_type, status,
          amount_total, currency, idempotency_key)
       VALUES ($1,$2,$3,$4,'full','pending','70.00','BRL','idem-stripe-charge')`,
      [chargeId, orgNoManual, stripeCustomer, stripeAcctId],
    );

    await expect(
      markChargePaidManually(
        orgNoManual,
        chargeId,
        { paid_at: PAID_AT, payment_method: "cash", reason: "tentativa indevida" },
        { clerkUserId },
      ),
    ).rejects.toMatchObject({ code: "INVALID_INPUT", message: "charge is not a manual charge" });
  });
});

describe("refundChargeManually (M5-P4 Task 8 — C1 deterministic refund id)", () => {
  const PAID_AT = "2026-05-22T10:00:00.000Z";

  /** Cria + marca-paga uma charge manual `full`; retorna o charge_id (paid). */
  async function createPaidFullCharge(amount: number, idemSuffix: string): Promise<string> {
    const created = await createManualCharge(
      orgWithManual,
      {
        customer_id: customerId,
        amount_total: amount,
        charge_type: "full",
        currency: "BRL",
        payment_method: "cash",
      },
      `idem-refund-${idemSuffix}`,
      { clerkUserId },
    );
    await markChargePaidManually(
      orgWithManual,
      created.charge_id,
      { paid_at: PAID_AT, payment_method: "cash", reason: "pago p/ refund test" },
      { clerkUserId },
    );
    return created.charge_id;
  }

  /** Cria + marca-paga uma charge manual `package`; retorna o charge_id (paid). */
  async function createPaidPackageCharge(
    spId: string,
    amount: number,
    idemSuffix: string,
  ): Promise<string> {
    const created = await createManualCharge(
      orgWithManual,
      {
        customer_id: customerId,
        amount_total: amount,
        charge_type: "package",
        service_package_id: spId,
        currency: "BRL",
        payment_method: "pix_manual",
      },
      `idem-refund-${idemSuffix}`,
      { clerkUserId },
    );
    await markChargePaidManually(
      orgWithManual,
      created.charge_id,
      { paid_at: PAID_AT, payment_method: "pix_manual", reason: "pacote pago p/ refund test" },
      { clerkUserId },
    );
    return created.charge_id;
  }

  it("(a) full refund of a paid package → refunded, payment reversed, package cancelled, audit", async () => {
    const spId = await seedServicePackage(orgWithManual, { sessionsIncluded: 5, validityDays: 30 });
    const chargeId = await createPaidPackageCharge(spId, 300.0, "full-pkg");

    const res = await refundChargeManually(
      orgWithManual,
      chargeId,
      { reason: "cliente desistiu" },
      "r1",
      { clerkUserId },
    );
    expect(res.status).toBe("refunded");
    expect(res.amount).toBe(300.0);

    // Charge flips to 'refunded'.
    const charge = await pool.query<{ status: string }>(
      `SELECT status FROM charges WHERE id = $1 AND organization_id = $2`,
      [chargeId, orgWithManual],
    );
    expect(charge.rows[0]!.status).toBe("refunded");

    // markPaymentReversed → the paid payment row becomes 'reversed'.
    const payments = await pool.query<{ status: string }>(
      `SELECT status FROM payments WHERE organization_id = $1 AND charge_id = $2`,
      [orgWithManual, chargeId],
    );
    expect(payments.rows.length).toBe(1);
    expect(payments.rows[0]!.status).toBe("reversed");

    // customer_package cancelled (full refund cancels the grant).
    const cps = await pool.query<{ status: string }>(
      `SELECT status FROM customer_packages WHERE organization_id = $1 AND charge_id = $2`,
      [orgWithManual, chargeId],
    );
    expect(cps.rows.length).toBe(1);
    expect(cps.rows[0]!.status).toBe("cancelled");

    // Audit charge.refunded_manual, actor_type=user, actor_id=resolved uuid, reason set.
    const audit = await pool.query<{
      actor_type: string;
      actor_id: string | null;
      reason_text: string | null;
    }>(
      `SELECT actor_type, actor_id, reason_text FROM audit_events
        WHERE organization_id = $1 AND entity_type = 'charge' AND entity_id = $2
          AND action = 'charge.refunded_manual'`,
      [orgWithManual, chargeId],
    );
    expect(audit.rows.length).toBe(1);
    expect(audit.rows[0]!.actor_type).toBe("user");
    expect(audit.rows[0]!.actor_id).toBe(seededUserId);
    expect(audit.rows[0]!.reason_text).toBe("cliente desistiu");
  });

  it("(b) partial < total → charge stays paid, succeeded refund row exists", async () => {
    const chargeId = await createPaidFullCharge(100.0, "partial");

    const res = await refundChargeManually(
      orgWithManual,
      chargeId,
      { amount: 50.0, reason: "estorno parcial" },
      "r2",
      { clerkUserId },
    );
    expect(res.status).toBe("paid");
    expect(res.amount).toBe(50.0);

    const charge = await pool.query<{ status: string }>(
      `SELECT status FROM charges WHERE id = $1 AND organization_id = $2`,
      [chargeId, orgWithManual],
    );
    expect(charge.rows[0]!.status).toBe("paid");

    const refunds = await pool.query<{
      status: string;
      amount: string;
      provider_refund_id: string;
    }>(
      `SELECT status, amount, provider_refund_id FROM refunds
        WHERE organization_id = $1 AND charge_id = $2`,
      [orgWithManual, chargeId],
    );
    expect(refunds.rows.length).toBe(1);
    expect(refunds.rows[0]!.status).toBe("succeeded");
    expect(Number(refunds.rows[0]!.amount)).toBe(50.0);
    expect(refunds.rows[0]!.provider_refund_id).toBe(`manual:refund:${chargeId}:r2`);
  });

  it("(c) two partials summing to total → second flips charge to refunded", async () => {
    const chargeId = await createPaidFullCharge(100.0, "two-partials");

    const first = await refundChargeManually(
      orgWithManual,
      chargeId,
      { amount: 40.0, reason: "parcial 1" },
      "r3a",
      { clerkUserId },
    );
    expect(first.status).toBe("paid");

    const second = await refundChargeManually(
      orgWithManual,
      chargeId,
      { amount: 60.0, reason: "parcial 2" },
      "r3b",
      { clerkUserId },
    );
    expect(second.status).toBe("refunded");

    const charge = await pool.query<{ status: string }>(
      `SELECT status FROM charges WHERE id = $1 AND organization_id = $2`,
      [chargeId, orgWithManual],
    );
    expect(charge.rows[0]!.status).toBe("refunded");

    // Two distinct succeeded refund rows (distinct idemKeys → distinct ids).
    const refunds = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM refunds
        WHERE organization_id = $1 AND charge_id = $2 AND status = 'succeeded'`,
      [orgWithManual, chargeId],
    );
    expect(refunds.rows[0]!.count).toBe("2");
  });

  it("(d) C1 double-submit same idemKey → exactly ONE refund row, idempotent, no double-count", async () => {
    const chargeId = await createPaidFullCharge(100.0, "dup");

    const input = { amount: 50.0, reason: "estorno (replay)" };
    // Mesma idemKey "rdup" duas vezes → mesmo provider_refund_id determinístico.
    const first = await refundChargeManually(orgWithManual, chargeId, input, "rdup", {
      clerkUserId,
    });
    // A 2ª NÃO deve lançar (replay verdadeiro é idempotente, não over-refund).
    const second = await refundChargeManually(orgWithManual, chargeId, input, "rdup", {
      clerkUserId,
    });
    expect(first.status).toBe("paid");
    expect(second.status).toBe("paid");

    // C1 PROOF: exactly ONE refund row para o provider_refund_id determinístico
    // — o dedupe de recordRefund colapsa o replay; sem double-count.
    const refunds = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM refunds
        WHERE organization_id = $1 AND charge_id = $2 AND provider_refund_id = $3`,
      [orgWithManual, chargeId, `manual:refund:${chargeId}:rdup`],
    );
    expect(refunds.rows[0]!.count).toBe("1");

    // Sem double-count: a soma persistida é 50 (não 100) → charge segue 'paid'.
    const charge = await pool.query<{ status: string }>(
      `SELECT status FROM charges WHERE id = $1 AND organization_id = $2`,
      [chargeId, orgWithManual],
    );
    expect(charge.rows[0]!.status).toBe("paid");
  });

  it("(e) over-refund → invalidInput (in-lock guard) + single-too-big (pre-lock guard)", async () => {
    const chargeId = await createPaidFullCharge(100.0, "over");

    // Partial refund first (charge STAYS 'paid' — cumulative 60 < 100).
    const partial = await refundChargeManually(
      orgWithManual,
      chargeId,
      { amount: 60.0, reason: "parcial" },
      "rf",
      { clerkUserId },
    );
    expect(partial.status).toBe("paid");

    // A NEW idemKey partial of 50 would push cumulative (60+50=110) past the
    // total (100) WHILE the charge is still 'paid' (passes the pre-lock paid
    // gate) → the IN-LOCK over-refund guard throws, propagating out of
    // withRedisLock (try/finally; finally only does fenced release).
    await expect(
      refundChargeManually(
        orgWithManual,
        chargeId,
        { amount: 50.0, reason: "tentativa extra" },
        "rover",
        { clerkUserId },
      ),
    ).rejects.toMatchObject({ code: "INVALID_INPUT", message: "refund exceeds charge total" });

    // The rejected over-refund recorded NO new refund row (guard threw before
    // recordRefund) → still exactly ONE succeeded refund, charge stays 'paid'.
    const refunds = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM refunds
        WHERE organization_id = $1 AND charge_id = $2 AND status = 'succeeded'`,
      [orgWithManual, chargeId],
    );
    expect(refunds.rows[0]!.count).toBe("1");
    const charge = await pool.query<{ status: string }>(
      `SELECT status FROM charges WHERE id = $1 AND organization_id = $2`,
      [chargeId, orgWithManual],
    );
    expect(charge.rows[0]!.status).toBe("paid");

    // Pre-lock guard: a single partial that alone exceeds total.
    const chargeId2 = await createPaidFullCharge(100.0, "over2");
    await expect(
      refundChargeManually(
        orgWithManual,
        chargeId2,
        { amount: 150.0, reason: "acima do total" },
        "rbig",
        { clerkUserId },
      ),
    ).rejects.toMatchObject({ code: "INVALID_INPUT", message: "refund amount out of range" });
  });

  it("(f) not refundable → invalidInput on a pending (not paid) manual charge", async () => {
    const created = await createManualCharge(
      orgWithManual,
      {
        customer_id: customerId,
        amount_total: 75.0,
        charge_type: "full",
        currency: "BRL",
        payment_method: "cash",
      },
      "idem-refund-pending",
      { clerkUserId },
    );
    // Sem mark-paid → charge fica 'pending' → não refundável.
    await expect(
      refundChargeManually(
        orgWithManual,
        created.charge_id,
        { reason: "tentativa em pending" },
        "rpend",
        { clerkUserId },
      ),
    ).rejects.toMatchObject({ code: "INVALID_INPUT", message: "charge not refundable" });
  });
});

describe("expireChargeManually (M5-P4 Task 9 — manual-only pending->expired)", () => {
  const PAID_AT = "2026-05-22T10:00:00.000Z";

  it("(a) pending → expired + audit charge.expired_manual (actor + reason)", async () => {
    const created = await createManualCharge(
      orgWithManual,
      {
        customer_id: customerId,
        amount_total: 110.0,
        charge_type: "full",
        currency: "BRL",
        payment_method: "cash",
      },
      "idem-expire-pending",
      { clerkUserId },
    );
    const chargeId = created.charge_id;

    const res = await expireChargeManually(
      orgWithManual,
      chargeId,
      { reason: "cliente não pagou no prazo" },
      { clerkUserId },
    );
    expect(res.status).toBe("expired");

    const charge = await pool.query<{ status: string }>(
      `SELECT status FROM charges WHERE id = $1 AND organization_id = $2`,
      [chargeId, orgWithManual],
    );
    expect(charge.rows[0]!.status).toBe("expired");

    const audit = await pool.query<{
      action: string;
      actor_type: string;
      actor_id: string | null;
      reason_text: string | null;
      actor_clerk_user_id: string | null;
    }>(
      `SELECT action, actor_type, actor_id, reason_text,
              after_json->>'actor_clerk_user_id' AS actor_clerk_user_id
         FROM audit_events
        WHERE organization_id = $1 AND entity_type = 'charge' AND entity_id = $2
          AND action = 'charge.expired_manual'`,
      [orgWithManual, chargeId],
    );
    expect(audit.rows.length).toBe(1);
    expect(audit.rows[0]!.actor_type).toBe("user");
    expect(audit.rows[0]!.actor_id).toBe(seededUserId);
    expect(audit.rows[0]!.reason_text).toBe("cliente não pagou no prazo");
    expect(audit.rows[0]!.actor_clerk_user_id).toBe(clerkUserId);
  });

  it("(b) already paid → not expirable (invalidInput)", async () => {
    const created = await createManualCharge(
      orgWithManual,
      {
        customer_id: customerId,
        amount_total: 95.0,
        charge_type: "full",
        currency: "BRL",
        payment_method: "cash",
      },
      "idem-expire-paid",
      { clerkUserId },
    );
    const chargeId = created.charge_id;

    await markChargePaidManually(
      orgWithManual,
      chargeId,
      { paid_at: PAID_AT, payment_method: "cash", reason: "pago antes de expirar" },
      { clerkUserId },
    );

    await expect(
      expireChargeManually(
        orgWithManual,
        chargeId,
        { reason: "tentativa indevida" },
        { clerkUserId },
      ),
    ).rejects.toMatchObject({ code: "INVALID_INPUT", message: "charge not expirable" });

    // Charge permanece 'paid' (guard barrou antes do UPDATE).
    const charge = await pool.query<{ status: string }>(
      `SELECT status FROM charges WHERE id = $1 AND organization_id = $2`,
      [chargeId, orgWithManual],
    );
    expect(charge.rows[0]!.status).toBe("paid");
  });

  it("(c) not a manual charge → invalidInput", async () => {
    // orgNoManual NÃO tem conta manual → getManualAccount=null → o guard
    // dispara em !acct antes mesmo de comparar payment_account_id. A charge
    // só precisa existir org-scoped; reusa/cria a conta Stripe org-level
    // (payment_accounts_org_uniq é org-level → no máx UMA conta org-level por
    // org; upsert+re-select torna o teste auto-suficiente independente de ordem).
    await pool.query(
      `INSERT INTO payment_accounts
         (id, organization_id, provider, account_holder_type, onboarding_status, charges_enabled,
          external_account_id)
       VALUES ($1,$2,'stripe','organization','active',true,'acct_test_stripe_expire')
       ON CONFLICT DO NOTHING`,
      [uuidv7(), orgNoManual],
    );
    const stripeAcct = await pool.query<{ id: string }>(
      `SELECT id FROM payment_accounts
         WHERE organization_id = $1 AND account_holder_type = 'organization' LIMIT 1`,
      [orgNoManual],
    );
    const stripeAcctId = stripeAcct.rows[0]!.id;
    const stripeCustomer = await seedCustomer(orgNoManual, "Cliente Stripe Expire");
    const chargeId = uuidv7();
    await pool.query(
      `INSERT INTO charges
         (id, organization_id, customer_id, payment_account_id, charge_type, status,
          amount_total, currency, idempotency_key)
       VALUES ($1,$2,$3,$4,'full','pending','70.00','BRL','idem-stripe-charge-expire')`,
      [chargeId, orgNoManual, stripeCustomer, stripeAcctId],
    );

    await expect(
      expireChargeManually(
        orgNoManual,
        chargeId,
        { reason: "tentativa indevida" },
        { clerkUserId },
      ),
    ).rejects.toMatchObject({ code: "INVALID_INPUT", message: "charge is not a manual charge" });
  });
});

describe("connectManualAccount (M5-P4 Task 10 — manual onboarding, active immediately)", () => {
  it("(a) creates an active manual account + audit payment_account.manual_configured", async () => {
    // Org FRESCA sem nenhuma conta org-level (manual insert succeeds).
    const orgFresh = await seedOrg("Manual Onboarding Org");

    const res = await connectManualAccount(orgFresh, { clerkUserId });
    expect(res.onboardingStatus).toBe("active");
    expect(res.paymentAccountId).toBeTruthy();

    const acct = await pool.query<{
      provider: string;
      account_holder_type: string;
      onboarding_status: string;
      charges_enabled: boolean;
      payouts_enabled: boolean;
      details_submitted: boolean;
    }>(
      `SELECT provider, account_holder_type, onboarding_status,
              charges_enabled, payouts_enabled, details_submitted
         FROM payment_accounts WHERE id = $1 AND organization_id = $2`,
      [res.paymentAccountId, orgFresh],
    );
    expect(acct.rows.length).toBe(1);
    const row = acct.rows[0]!;
    expect(row.provider).toBe("manual");
    expect(row.account_holder_type).toBe("organization");
    expect(row.onboarding_status).toBe("active");
    expect(row.charges_enabled).toBe(true);
    expect(row.payouts_enabled).toBe(false);
    expect(row.details_submitted).toBe(true);

    const audit = await pool.query<{
      action: string;
      actor_type: string;
      provider: string | null;
      actor_clerk_user_id: string | null;
    }>(
      `SELECT action, actor_type,
              after_json->>'provider' AS provider,
              after_json->>'actor_clerk_user_id' AS actor_clerk_user_id
         FROM audit_events
        WHERE organization_id = $1 AND entity_type = 'payment_account' AND entity_id = $2
          AND action = 'payment_account.manual_configured'`,
      [orgFresh, res.paymentAccountId],
    );
    expect(audit.rows.length).toBe(1);
    expect(audit.rows[0]!.actor_type).toBe("user");
    expect(audit.rows[0]!.provider).toBe("manual");
    expect(audit.rows[0]!.actor_clerk_user_id).toBe(clerkUserId);
  });

  it("(b) idempotent → same paymentAccountId, exactly ONE manual row", async () => {
    const orgFresh = await seedOrg("Manual Onboarding Idempotent Org");

    const first = await connectManualAccount(orgFresh, { clerkUserId });
    const second = await connectManualAccount(orgFresh, { clerkUserId });
    expect(second.paymentAccountId).toBe(first.paymentAccountId);
    expect(second.onboardingStatus).toBe("active");

    const count = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM payment_accounts
        WHERE organization_id = $1 AND provider = 'manual'
          AND account_holder_type = 'organization'`,
      [orgFresh],
    );
    expect(count.rows[0]!.count).toBe("1");
  });
});
