/**
 * Orquestrador C3. Drena UM intent do waitlist_match_outbox:
 *  - single-flight Redis por calendário (withRedisLock fenced, google/lock.ts);
 *  - seleção pura (match.ts) sobre candidatos `waiting`;
 *  - consumo CAS por candidato (corrida resolvida no DB);
 *  - auto_book → createAppointment INALTERADO (idempotencyKey determinístico);
 *  - offer → status 'offered' + publishRealtime + audit (entrega ao cliente
 *    = follow-on M4; sem seam falso).
 * Lock não adquirido → deixa o intent 'processing' (o sweep re-enfileira).
 */
import { createAppointment } from "@/modules/calendar/booking.js";
import { withRedisLock } from "@/modules/calendar/google/lock.js";
import { publishRealtime } from "@/modules/realtime/publish.js";
import { logger } from "@/shared/logger.js";

import { WAITLIST_MATCH_LOCK_TTL_SECONDS, waitlistMatchLockKey } from "./constants.js";
import { selectBestCandidates } from "./match.js";
import { parseWaitlistPolicy } from "./policy.js";
import * as repo from "./repository.js";

const DEAD_LETTER_FALLBACK = 5;

export async function runWaitlistMatch(
  row: repo.WaitlistOutboxRow,
  deadLetterMax: number = DEAD_LETTER_FALLBACK,
): Promise<void> {
  const log = logger();
  try {
    const ran = await withRedisLock(
      waitlistMatchLockKey(row.calendar_id),
      WAITLIST_MATCH_LOCK_TTL_SECONDS,
      () => matchOne(row),
    );
    if (ran === null) {
      // Lock ocupado: outro worker já está casando este calendário. Deixa
      // 'processing'; o sweep (requeueStuckProcessing) devolve a 'pending'.
      return;
    }
    await repo.finishMatch(row.id, "done");
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown";
    if (row.attempts + 1 >= deadLetterMax) {
      // PII-safe: só ids + msg de erro, nunca dados de cliente.
      log.error(
        { outboxId: row.id, calendarId: row.calendar_id, attempts: row.attempts + 1 },
        "waitlist match dead-lettered",
      );
      await repo.finishMatch(row.id, "dead", msg);
    } else {
      await repo.requeueMatch(row.id, msg);
    }
  }
}

async function matchOne(row: repo.WaitlistOutboxRow): Promise<void> {
  const slot = {
    slot_start_at: new Date(row.slot_start_at),
    service_id: row.service_id,
    professional_id: row.professional_id,
  };
  const policy = parseWaitlistPolicy(await repo.loadWaitlistPolicyJson(row.service_id));
  const candidates = await repo.loadWaitingCandidates(row.calendar_id);
  const ordered = selectBestCandidates(candidates, slot, policy);

  for (const cand of ordered) {
    if (policy.mode === "offer") {
      const offerExpires = new Date(Date.now() + policy.offer_window_minutes * 60_000);
      const claimed = await repo.casClaimEntry(cand.id, "offered", {
        offeredAt: new Date(),
        offerExpiresAt: offerExpires,
      });
      if (!claimed) continue; // corrida perdida → próximo
      await repo.insertWaitlistAudit({
        organizationId: row.organization_id,
        entryId: cand.id,
        action: "waitlist.offered",
        afterJson: {
          calendar_id: row.calendar_id,
          slot_start_at: row.slot_start_at,
          offer_expires_at: offerExpires.toISOString(),
        },
      });
      await publishRealtime(row.organization_id, "waitlist.offered", {
        entry_id: cand.id,
        calendar_id: row.calendar_id,
        slot_start_at: row.slot_start_at,
        offer_expires_at: offerExpires.toISOString(),
      });
      return; // uma oferta por slot liberado
    }

    // auto_book: claim provisório 'accepted' (CAS), depois cria o appointment.
    const claimed = await repo.casClaimEntry(cand.id, "accepted", {});
    if (!claimed) continue;
    const e = await repo.getEntryForBooking(cand.id);
    if (!e || !e.service_id) {
      // Sem serviço não dá p/ criar appointment (createAppointment exige
      // serviceId). Reverte e segue — honesto, sem appointment-fantasma.
      await repo.revertAcceptedToWaiting(cand.id);
      continue;
    }
    const slotIso = slot.slot_start_at.toISOString();
    const r = await createAppointment({
      organizationId: e.organization_id,
      calendarId: e.calendar_id,
      serviceId: e.service_id,
      professionalId: e.professional_id ?? slot.professional_id ?? null,
      customerId: e.customer_id,
      customerName: e.customer_name,
      customerPhone: e.customer_phone,
      customerEmail: e.customer_email,
      date: slotIso.slice(0, 10),
      startTime: slotIso.slice(11, 16),
      source: "waitlist" as unknown as "ai" | "manual",
      idempotencyKey: `wl:${cand.id}:${slotIso}`,
    });
    if (r.status === "slot_conflict") {
      await repo.revertAcceptedToWaiting(cand.id);
      continue; // slot tomado entre liberar e promover → próximo candidato
    }
    await repo.attachAppointment(cand.id, r.appointment_id!);
    await repo.insertWaitlistAudit({
      organizationId: e.organization_id,
      entryId: cand.id,
      action: "waitlist.matched",
      afterJson: { appointment_id: r.appointment_id, slot_start_at: row.slot_start_at },
    });
    return; // promovido — pronto
  }
  // Nenhum candidato elegível/claimável → outbox 'done' (resultado honesto).
}

/**
 * Safety sweep (repeatable). Idempotente:
 *  1. processing órfão (>10min) → pending (re-drenado);
 *  2. accepted-órfão sem appointment (>10min) → waiting (crash-safe reaper,
 *     simétrico ao de ofertas — fecha o gap achado no review da Task 7);
 *  3. ofertas expiradas → waiting (canon §5.5; re-oferta em novo slot);
 *  4. waiting com janela totalmente no passado → expired (terminal);
 *  5. drena o lote pendente atual.
 */
export async function runWaitlistSweep(deadLetterMax: number): Promise<void> {
  await repo.requeueStuckProcessing(10);
  await repo.expireStaleAccepted(10);
  await repo.expireStaleOffers();
  await repo.expireStaleWaiting();
  const batch = await repo.claimMatchBatch(50);
  for (const row of batch) {
    await runWaitlistMatch(row, deadLetterMax);
  }
}

/** Drena o lote pendente (gatilho nudge). */
export async function drainWaitlistMatch(deadLetterMax: number): Promise<void> {
  const batch = await repo.claimMatchBatch(50);
  for (const row of batch) {
    await runWaitlistMatch(row, deadLetterMax);
  }
}
