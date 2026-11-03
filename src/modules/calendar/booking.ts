/**
 * Booking M3-C1. Concorrência: a invariante de capacidade
 * (max_concurrent) NÃO é expressável como EXCLUDE constraint sob
 * max_concurrent>1 — é garantida por SERIALIZAÇÃO transacional:
 * pg_advisory_xact_lock(hashtext(professional_id||date)) +
 * re-contagem de overlap DENTRO do lock vs max_concurrent + INSERT.
 * O lock é por-profissional-por-dia (NÃO por slot): a re-contagem
 * casa QUALQUER agendamento com sobreposição temporal, então o lock
 * precisa serializar todas as reservas do mesmo profissional no mesmo
 * dia para a re-contagem ser autoritativa; granularidade por slot
 * deixaria starts distintos mas sobrepostos competir sem contenção.
 * Exactly-once do mesmo proposal: idempotency_key (Redis 24h +
 * índice único appointments_org_idempotency_uniq como rede). Precedente
 * service.ts:42 (seam roda antes do UPDATE guardado → idempotency_key
 * é a única defesa exactly-once). Overlap re-check é per-professional
 * global (NÃO por calendar), consistente com availability.ts (Task 3).
 */
import { sql } from "drizzle-orm";

import { getDb } from "@/db/client.js";
import { getGooglePushQueue, getWaitlistMatchQueue } from "@/lib/queues.js";
import { getRedis } from "@/lib/redis.js";
import { errors } from "@/shared/errors.js";
import { uuidv7 } from "@/shared/uuid.js";

import { GOOGLE_PUSH_JOB_NAME } from "./google/constants.js";
import { WAITLIST_MATCH_JOB_NAME } from "./waitlist/constants.js";
import { enqueueMatchIntentTx } from "./waitlist/repository.js";

import { getAvailableSlots, formatTime, parseMinutes } from "./availability.js";
import { getServicePolicy } from "./repository.js";

export interface BookResult {
  status: "booked" | "slot_conflict";
  appointment_id?: string;
}

/**
 * Detecta unique-violation (pg SQLSTATE 23505) no índice
 * `appointments_org_idempotency_uniq`. pg/node-postgres lança um
 * `DatabaseError` com `.code` string; drizzle node-postgres o propaga
 * sem reescrever. Guard estrutural (mesmo padrão de
 * error-handler.ts:isFastifyValidationError) — só trata 23505 nesse
 * índice como replay idempotente; qualquer outra coisa re-lança.
 */
function isIdempotencyUniqueViolation(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  // Drizzle envelopa o erro pg em `DrizzleQueryError` que NÃO carrega
  // `code`/`constraint` na raiz; eles ficam em `err.cause` (o pg Error
  // original). Olhar ambos pra cobrir o caminho direto + envelopado.
  const e = err as { code?: unknown; constraint?: unknown; cause?: unknown };
  const target =
    e.code !== undefined ? e : ((e.cause as { code?: unknown; constraint?: unknown } | null) ?? e);
  const t = target as { code?: unknown; constraint?: unknown };
  if (t.code !== "23505") return false;
  // `constraint` pode não vir preenchido em todos os caminhos; se vier,
  // exigimos que seja o índice de idempotência. Se ausente, aceitamos o
  // 23505 (o único índice único com idempotency_key em appointments).
  return t.constraint === undefined || t.constraint === "appointments_org_idempotency_uniq";
}

/**
 * Best-effort: acorda o push-drain p/ esvaziar o outbox sem esperar o cron
 * de 1min. SEMPRE chamado APÓS o commit da tx (nunca dentro — nunca acordar
 * um intent que pode rolar back). Falha de enqueue é silenciosa: o cron
 * `bevox.google.push` (* * * * *) é a rede de segurança.
 */
function nudgeGooglePush(): void {
  void getGooglePushQueue()
    .add(GOOGLE_PUSH_JOB_NAME, {})
    .catch(() => undefined);
}

/**
 * Best-effort: acorda o waitlist-match drain sem esperar o cron de safety.
 * SEMPRE pós-commit (nunca dentro da tx). Falha de enqueue silenciosa: o
 * sweep repeatable é a rede de segurança.
 */
function nudgeWaitlistMatch(): void {
  void getWaitlistMatchQueue()
    .add(WAITLIST_MATCH_JOB_NAME, {})
    .catch(() => undefined);
}

async function idemHit(orgId: string, key: string | undefined): Promise<string | null> {
  if (!key) return null;
  const v = await getRedis().get(`booking:idem:${orgId}:${key}`);
  return v ?? null;
}

async function idemStore(orgId: string, key: string | undefined, apptId: string): Promise<void> {
  if (!key) return;
  await getRedis().set(`booking:idem:${orgId}:${key}`, apptId, "EX", 86400);
}

async function findByIdempotencyKey(orgId: string, key: string): Promise<string | null> {
  const r = await getDb().execute(
    sql`SELECT id FROM appointments WHERE organization_id = ${orgId} AND idempotency_key = ${key} LIMIT 1`,
  );
  const row = r.rows[0] as { id: string } | undefined;
  return row?.id ?? null;
}

export async function createAppointment(input: {
  organizationId: string;
  calendarId: string;
  serviceId: string;
  professionalId?: string | null;
  customerId?: string | null;
  customerName?: string | null;
  customerPhone?: string | null;
  customerEmail?: string | null;
  customerPackageId?: string | null;
  date: string;
  startTime: string;
  source: "ai" | "manual";
  conversationId?: string | null;
  idempotencyKey?: string;
  metadata?: Record<string, unknown> | null;
}): Promise<BookResult> {
  const db = getDb();
  const cached = await idemHit(input.organizationId, input.idempotencyKey);
  if (cached) return { status: "booked", appointment_id: cached };

  const svcR = await db.execute(
    sql`SELECT duration_minutes, max_concurrent, requires_prepayment, price_amount FROM services WHERE id = ${input.serviceId} AND organization_id = ${input.organizationId} AND is_active = true LIMIT 1`,
  );
  const svc = svcR.rows[0] as
    | {
        duration_minutes: number;
        max_concurrent: number;
        requires_prepayment: boolean | null;
        price_amount: string | null;
      }
    | undefined;
  if (!svc) throw errors.notFound("Service", input.serviceId);
  const calR = await db.execute(
    sql`SELECT timezone FROM calendars WHERE id = ${input.calendarId} AND organization_id = ${input.organizationId} AND is_active = true LIMIT 1`,
  );
  const cal = calR.rows[0] as { timezone: string } | undefined;
  if (!cal) throw errors.notFound("Calendar", input.calendarId);

  // P4: validação fail-closed do customer_package_id ANTES da tx (dynamic
  // import preserva boundary calendar↔payments — mesmo precedente do P2
  // prepayment hook abaixo).
  if (input.customerPackageId) {
    const repo = await import("@/modules/payments/repository.js");
    const pkgIntent = await import("@/modules/payments/package-intent.js");
    const cp = await repo.getCustomerPackageById(input.organizationId, input.customerPackageId);
    if (!cp) throw errors.notFound("CustomerPackage", input.customerPackageId);
    // SEV-HIGH-01 fix: cp.customer_id é sempre non-null (canon §11.6 +
    // buildCustomerPackageFromGrant exige customer_id na charge); um
    // input.customerId null vs cp.customer_id (non-null) → 400 fail-closed,
    // fechando o leak "appointment sem customer consumindo pacote de Alice".
    if (cp.customer_id !== input.customerId) {
      throw errors.invalidInput("customer_package customer mismatch", {
        customer_package_id: input.customerPackageId,
      });
    }
    const nowIso = new Date().toISOString().slice(0, 10);
    const check = pkgIntent.canDecrement(cp, nowIso);
    if (!check.ok) {
      throw errors.invalidInput("customer_package not usable", {
        customer_package_id: input.customerPackageId,
        reason: check.reason,
      });
    }
    // service_package.service_id null = genérico (qualquer service casa);
    // não-null deve casar exatamente o appointment.serviceId.
    const sp = await repo.getServicePackageById(input.organizationId, cp.service_package_id);
    if (sp && sp.service_id !== null && sp.service_id !== input.serviceId) {
      throw errors.invalidInput("customer_package service mismatch", {
        customer_package_id: input.customerPackageId,
        expected_service_id: sp.service_id,
      });
    }
  }

  const startNorm = formatTime(parseMinutes(input.startTime));
  const endNorm = formatTime(parseMinutes(input.startTime) + svc.duration_minutes);
  const startTs = sql`((${input.date} || ' ' || ${startNorm})::timestamp AT TIME ZONE ${cal.timezone})`;
  const endTs = sql`((${input.date} || ' ' || ${endNorm})::timestamp AT TIME ZONE ${cal.timezone})`;

  // Reconciliação da Task 3: em vez de um pruning "isToday/past-slot",
  // a regra canônica é o booking_notice_minutes da
  // service_policies. Se houver janela de antecedência > 0 e o instante
  // de início do slot for antes de now()+notice, o slot é cedo demais —
  // tratado como slot_conflict (mesmo shape; sem novo status).
  const policy = await getServicePolicy(input.organizationId, input.serviceId);
  const bookingNotice = Number(policy?.booking_notice_minutes ?? 0);
  if (bookingNotice > 0) {
    const tooSoonR = await db.execute(
      sql`SELECT (${startTs} < now() + (${bookingNotice} || ' minutes')::interval) AS too_soon`,
    );
    if ((tooSoonR.rows[0] as { too_soon: boolean }).too_soon) {
      return { status: "slot_conflict" };
    }
  }

  const avail = await getAvailableSlots({
    organizationId: input.organizationId,
    calendarId: input.calendarId,
    serviceId: input.serviceId,
    date: input.date,
  });
  const slot = avail.slots.find((s) => s.start_time === startNorm);
  if (!slot) return { status: "slot_conflict" };
  let professionalId = input.professionalId ?? null;
  if (professionalId) {
    const pid = professionalId;
    const m = slot.available_members.find((x) => x.professional_id === pid);
    if (!m || m.remaining_capacity <= 0) return { status: "slot_conflict" };
  } else {
    const first = slot.available_members[0];
    if (!first) return { status: "slot_conflict" };
    professionalId = first.professional_id;
  }

  const id = uuidv7();

  let conflict: boolean;
  try {
    conflict = await db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtext(${professionalId + "|" + input.date}))`,
      );
      const reR = await tx.execute(sql`
        SELECT COUNT(*)::int AS count FROM appointments
        WHERE professional_id = ${professionalId} AND status NOT IN ('cancelled')
          AND start_at < ${endTs} AND end_at > ${startTs}`);
      const booked = Number((reR.rows[0] as { count: number }).count ?? 0);
      if (booked >= svc.max_concurrent) return true;
      await tx.execute(sql`
        INSERT INTO appointments
          (id, organization_id, calendar_id, service_id, professional_id, customer_id,
           customer_package_id, conversation_id, customer_name, customer_phone, customer_email,
           start_at, end_at, status, source, idempotency_key, metadata)
        VALUES (${id}, ${input.organizationId}, ${input.calendarId}, ${input.serviceId},
                ${professionalId}, ${input.customerId ?? null}, ${input.customerPackageId ?? null},
                ${input.conversationId ?? null}, ${input.customerName ?? null},
                ${input.customerPhone ?? null}, ${input.customerEmail ?? null},
                ${startTs}, ${endTs}, 'scheduled', ${input.source}, ${input.idempotencyKey ?? null},
                ${input.metadata ? JSON.stringify(input.metadata) : null}::jsonb)`);
      await tx.execute(sql`
        INSERT INTO google_sync_outbox (id, organization_id, appointment_id, op, status)
        VALUES (${uuidv7()}, ${input.organizationId}, ${id}, 'create', 'pending')`);
      return false;
    });
  } catch (err) {
    // Rede de segurança do DB: se o Redis perdeu a chave, um 2º INSERT
    // com o mesmo (organization_id, idempotency_key) bate no índice
    // único appointments_org_idempotency_uniq → 23505. Tratamos como
    // replay idempotente: re-lê o appointment existente. Qualquer outro
    // erro re-lança.
    if (input.idempotencyKey && isIdempotencyUniqueViolation(err)) {
      const existing = await findByIdempotencyKey(input.organizationId, input.idempotencyKey);
      if (existing) {
        await idemStore(input.organizationId, input.idempotencyKey, existing);
        return { status: "booked", appointment_id: existing };
      }
    }
    throw err;
  }
  if (conflict) return { status: "slot_conflict" };
  await idemStore(input.organizationId, input.idempotencyKey, id);
  // Pós-commit: o INSERT do outbox 'create' está commitado → seguro acordar
  // o push-drain.
  nudgeGooglePush();

  // Payments P2 — hook requires_prepayment (canon Fluxo 3 §8.3 step 4).
  // Best-effort, NÃO-FATAL, FORA da transação do appointment: falha de
  // Stripe / payment-account-não-active NUNCA faz rollback nem bloqueia o
  // appointment (confirmação fica gated por payment_intent.succeeded,
  // canon §8.4). price_amount nullable ⇒ skip honesto.
  if (svc.requires_prepayment === true) {
    try {
      const { createCharge } = await import("@/modules/payments/service.js");
      const repo = await import("@/modules/payments/repository.js");
      // Fail-closed ANTES do createCharge: a hook chama createCharge
      // DIRETO (não passa por validateChargeInput, que só roda nos
      // entrypoints REST/seam — charge-flow audit). Sem este guard um
      // price_amount '0.00'/negativo/NaN ou customer ausente criaria uma
      // charge `pending` lixo ligada a um appointment real. null/inválido/
      // sem-customer ⇒ skip honesto (zero chamada Stripe), motivo auditado.
      const amt = svc.price_amount === null ? NaN : Number(svc.price_amount);
      let skipReason: string | null = null;
      if (svc.price_amount === null) skipReason = "service_price_amount_null";
      else if (!Number.isFinite(amt) || amt <= 0) skipReason = "service_price_amount_invalid";
      else if (!input.customerId) skipReason = "service_requires_customer";
      if (skipReason) {
        await repo.insertChargeAudit({
          organizationId: input.organizationId,
          chargeId: id,
          action: "charge.hook_skipped",
          actorType: "system",
          afterJson: { reason: skipReason, appointment_id: id },
        });
      } else {
        await createCharge(
          input.organizationId,
          {
            customer_id: input.customerId as string,
            appointment_id: id,
            service_id: input.serviceId,
            professional_id: input.professionalId ?? undefined,
            amount_total: amt,
            charge_type: "full",
            currency: "BRL",
            payment_method: "pix",
          },
          `prepay:${id}`,
          "system",
        );
      }
    } catch (err) {
      // Outer catch AIRTIGHT: tudo (logger + audit) dentro de um try
      // que engole — nada na hook pode propagar p/ createAppointment
      // (o appointment já está commitado; return 'booked' é garantido).
      try {
        const { logger } = await import("@/shared/logger.js");
        logger().warn(
          { appointmentId: id, err },
          "requires_prepayment charge hook failed (non-fatal; appointment kept)",
        );
        const repo = await import("@/modules/payments/repository.js");
        await repo.insertChargeAudit({
          organizationId: input.organizationId,
          chargeId: id,
          action: "charge.hook_failed",
          actorType: "system",
          afterJson: {
            appointment_id: id,
            error: err instanceof Error ? err.message : String(err),
          },
        });
      } catch {
        // best-effort total; nunca propaga.
      }
    }
  }

  return { status: "booked", appointment_id: id };
}

export async function rescheduleAppointment(
  orgId: string,
  id: string,
  b: { date?: string; start_time?: string; professional_id?: string | null },
  calendarTzFallback: string,
) {
  const db = getDb();
  const cur = await db.execute(
    sql`SELECT * FROM appointments WHERE id = ${id} AND organization_id = ${orgId} LIMIT 1`,
  );
  const a = cur.rows[0] as Record<string, unknown> | undefined;
  if (!a) throw errors.notFound("Appointment", id);
  const pol = await db.execute(
    sql`SELECT reschedule_notice_minutes FROM service_policies WHERE service_id = ${a["service_id"] as string} LIMIT 1`,
  );
  const noticeMin = Number(
    (pol.rows[0] as { reschedule_notice_minutes: number | null } | undefined)
      ?.reschedule_notice_minutes ?? 0,
  );
  if (noticeMin > 0) {
    const tooLate = await db.execute(
      sql`SELECT (start_at < now() + (${noticeMin} || ' minutes')::interval) AS late FROM appointments WHERE id = ${id}`,
    );
    if ((tooLate.rows[0] as { late: boolean }).late)
      throw errors.conflict("Reschedule notice window violated", { appointment_id: id });
  }
  const date = b.date ?? String(a["start_at"]).slice(0, 10);
  const start = b.start_time ?? formatTime(0);
  const r = await createAppointment({
    organizationId: orgId,
    calendarId: a["calendar_id"] as string,
    serviceId: a["service_id"] as string,
    professionalId: b.professional_id ?? (a["professional_id"] as string),
    customerId: a["customer_id"] as string | null,
    conversationId: a["conversation_id"] as string | null,
    customerName: a["customer_name"] as string | null,
    customerPhone: a["customer_phone"] as string | null,
    customerEmail: a["customer_email"] as string | null,
    customerPackageId: (a["customer_package_id"] as string | null) ?? null,
    date,
    startTime: b.start_time ?? start,
    source: a["source"] as "ai" | "manual",
    idempotencyKey: undefined,
  });
  if (r.status === "slot_conflict") return r;
  await db.transaction(async (tx) => {
    const c = await tx.execute(
      sql`UPDATE appointments SET status = 'cancelled', cancelled_at = now(), cancellation_reason = 'rescheduled', updated_at = now() WHERE id = ${id} AND organization_id = ${orgId} RETURNING start_at, calendar_id, service_id, professional_id`,
    );
    await tx.execute(sql`
      INSERT INTO google_sync_outbox (id, organization_id, appointment_id, op, status)
      VALUES (${uuidv7()}, ${orgId}, ${id}, 'delete', 'pending')`);
    const row = c.rows[0] as
      | {
          start_at: string;
          calendar_id: string;
          service_id: string | null;
          professional_id: string | null;
        }
      | undefined;
    if (row) {
      await enqueueMatchIntentTx(tx, {
        organizationId: orgId,
        calendarId: row.calendar_id,
        slotStartAt: new Date(row.start_at),
        serviceId: row.service_id,
        professionalId: row.professional_id,
      });
    }
  });
  // Pós-commit: createAppointment já fez seu próprio nudge (intent
  // 'create'); aqui acordamos de novo p/ o intent 'delete' recém-commitado
  // e o waitlist-match do slot antigo liberado.
  nudgeGooglePush();
  nudgeWaitlistMatch();
  void calendarTzFallback;
  return r;
}

export async function transitionAppointment(
  orgId: string,
  id: string,
  status: "cancelled" | "confirmed" | "completed" | "no_show",
  reason?: string | null,
) {
  let txCustomerPackageId: string | null = null;
  // P4: capturado dentro da tx — gate p/ o hook decrement post-commit
  // (Task 5 SEV-INFO-04 closure: same-status re-fire NÃO deve double-decrementar).
  let txStatusChanged = false;
  const ok = await getDb().transaction(async (tx) => {
    // P4 SEV-INFO-04: SELECT do status atual ANTES da UPDATE para detectar
    // transição real. UPDATE permanece incondicional (preserva contrato dos
    // callers P2 existentes que dependem do retorno {ok:true} mesmo em
    // same-status calls); só o hook decrement é gated em prevStatus !== status.
    const prevR = await tx.execute(sql`
      SELECT status FROM appointments
      WHERE id = ${id} AND organization_id = ${orgId} LIMIT 1`);
    if (prevR.rows.length === 0) return false;
    const prevStatus = (prevR.rows[0] as { status: string }).status;

    const r = await tx.execute(sql`
      UPDATE appointments SET status = ${status}, updated_at = now(),
        cancelled_at = CASE WHEN ${status}='cancelled' THEN now() ELSE cancelled_at END,
        cancellation_reason = CASE WHEN ${status}='cancelled' THEN ${reason ?? null} ELSE cancellation_reason END
      WHERE id = ${id} AND organization_id = ${orgId}
      RETURNING id, start_at, calendar_id, service_id, professional_id, customer_package_id`);
    if (r.rows.length === 0) return false;
    const row = r.rows[0] as {
      start_at: string;
      calendar_id: string;
      service_id: string | null;
      professional_id: string | null;
      customer_package_id: string | null;
    };
    txCustomerPackageId = row.customer_package_id;
    txStatusChanged = prevStatus !== status;
    if (status === "cancelled") {
      await tx.execute(sql`
        INSERT INTO google_sync_outbox (id, organization_id, appointment_id, op, status)
        VALUES (${uuidv7()}, ${orgId}, ${id}, 'delete', 'pending')`);
      await enqueueMatchIntentTx(tx, {
        organizationId: orgId,
        calendarId: row.calendar_id,
        slotStartAt: new Date(row.start_at),
        serviceId: row.service_id,
        professionalId: row.professional_id,
      });
    }
    return true;
  });
  if (!ok) throw errors.notFound("Appointment", id);
  nudgeGooglePush();
  nudgeWaitlistMatch();

  // P4: decrement hook post-commit (best-effort, NUNCA regride a transição).
  // Triggers em 'completed' sempre; em 'no_show' apenas se o flag
  // payment_accounts.split_config_json.no_show_consumes_session === true
  // para esta org (default false = canon-literal).
  // GATE SEV-INFO-04: só dispara se txStatusChanged — same-status re-fire
  // (idempotent SQL UPDATE) NÃO produz double-decrement.
  if (
    txStatusChanged &&
    txCustomerPackageId !== null &&
    (status === "completed" || status === "no_show")
  ) {
    try {
      const repo = await import("@/modules/payments/repository.js");
      let shouldDecrement = status === "completed";
      if (!shouldDecrement) {
        shouldDecrement = await repo.getPaymentAccountNoShowFlag(orgId);
      }
      if (shouldDecrement) {
        const { decrementCustomerPackageForAppointment } =
          await import("@/modules/payments/service.js");
        await decrementCustomerPackageForAppointment(orgId, id, txCustomerPackageId);
      }
    } catch (err) {
      // hook outer absorve — transição já comitada não regride.
      try {
        const { logger } = await import("@/shared/logger.js");
        logger().error(
          { orgId, appointmentId: id, err },
          "P4 package decrement hook unexpected throw (transition NOT regressed)",
        );
      } catch {
        // best-effort total; nunca propaga.
      }
    }
  }

  return { ok: true, status };
}
