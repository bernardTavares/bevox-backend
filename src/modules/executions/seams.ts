/**
 * Seams canon-shaped (bevox-backend/ADR-019 — supersedes hub ADR-025; padrão resolveInboundChannel B1→C/D).
 * Interface modelada na chamada FUTURA Calendar/Payments/outbound; a
 * impl transitória é HONESTA: registra estado-pendente durável, NUNCA
 * chama serviço externo, NUNCA retorna "success" falso. M3 troca a impl
 * de executeProposals (Calendar/Payments reais); M4 a de deliverToChannel
 * (outbound/sucessor próprio). Interface inalterada → zero retrabalho.
 */

import { env } from "@/config/env.js";
import { sendMessage } from "@/modules/channels/metaapi/client.js";
import {
  findMetaApiTenant,
  findExecutionDeliveryContext,
  insertMessageAudit,
  insertMessageRecord,
} from "@/modules/channels/metaapi/repository.js";
import { validateAndBuild } from "@/modules/channels/metaapi/send-message-intent.js";
import { logger } from "@/shared/logger.js";
import {
  metaapiOutboundMessagesTotal,
  metaapiOutboundRetriesTotal,
  metaapiOutboundLatencySeconds,
} from "@/shared/metrics.js";

const RETRY_DELAYS_MS = [1000, 2000, 4000];
const RETRYABLE_CODES = new Set(["META_UNAVAILABLE", "RATE_LIMITED", "INTERNAL", "UNKNOWN"]);

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * M5-P2a Item 9 — AbortError thrown by abortableSleep when the caller's
 * AbortSignal is triggered. Distinct name preserves observability vs
 * generic Error in BullMQ failure logs.
 *
 * Spec: docs/superpowers/specs/2026-05-21-backend-m5-p2-tech-debt-design.md §4.6
 */
export class AbortError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AbortError";
  }
}

/**
 * M5-P2a Item 9 — abortable variant of sleep(ms). When signal aborts,
 * clears pending timer + rejects with AbortError immediately (no leak).
 * Pre-aborted signal rejects synchronously before scheduling the timer.
 *
 * Wired em deliverToChannel via env flag RETRY_ABORTABLE (default false
 * em V1 → Marco 4 baseline preserved). Flip true em staging per spec
 * §4.6 cutover criteria.
 *
 * Spec: docs/superpowers/specs/2026-05-21-backend-m5-p2-tech-debt-design.md §4.6
 */
export async function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) throw new AbortError("aborted before sleep");
  if (!signal) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(new AbortError("aborted during sleep"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export interface Proposal {
  action: string;
  params: Record<string, unknown>;
  idempotency_key: string;
}

export interface ProposalExecutionResult {
  status: "executed" | "partial" | "deferred";
  results: Array<{
    action: string;
    status: "success" | "slot_conflict" | "deferred" | "error";
    appointment_id?: string;
    idempotency_key: string;
  }>;
}

export type DeliveryResult =
  | {
      status: "sent";
      channel: string;
      message_id: string;
      provider_message_id: string;
      attempt_count: number;
    }
  | {
      status: "failed_retryable_exhausted";
      channel: string;
      error_code: string;
      last_error_message: string;
      attempt_count: number;
    }
  | { status: "failed_rejected"; channel: string; error_code: string; error_message: string }
  | { status: "skipped_empty_text" }
  | { status: "skipped_missing_recipient" }
  | { status: "skipped_missing_tenant"; organization_id: string };

/**
 * PRD §8.1: outbound delivery failure → execution.status='error'.
 *
 * Centraliza a regra: APENAS `failed_*` (META rejeitou / retries exauridos)
 * conta como falha de entrega; `skipped_*` é no-op intencional (texto vazio,
 * recipient ausente, tenant não conectado — auditados como `metaapi.send.
 * skipped`) e NÃO degrada a execução para `error`. `sent` é sucesso.
 *
 * Spec: prds/modulos/bevox-backend-prd-v1.md §8.1 — "entrega falha → status='error'"
 */
export function isDeliveryFailure(result: DeliveryResult): boolean {
  return result.status === "failed_retryable_exhausted" || result.status === "failed_rejected";
}

export async function executeProposals(input: {
  organizationId: string;
  executionId: string;
  conversationId: string;
  proposals: Proposal[];
  approverClerkUserId?: string;
}): Promise<ProposalExecutionResult> {
  // M3-C1: ações de calendar → booking REAL (Task 4); demais ações
  // (create-charge = Payments M3 futuro, send-message = M4 outbound)
  // permanecem HONESTAS `deferred`. Assinatura de INPUT inalterada.
  // Imports dinâmicos: evitam ciclo executions↔calendar e mantêm o seam
  // sem dependência estática do módulo trocado.
  const { createAppointment, rescheduleAppointment, transitionAppointment } =
    await import("@/modules/calendar/booking.js");
  const { resolveConversationCalendarContext } = await import("@/modules/calendar/seam-context.js");

  const results: ProposalExecutionResult["results"] = [];
  for (const p of input.proposals) {
    if (p.action === "waitlist-add") {
      try {
        const { handleWaitlistAdd } = await import("@/modules/calendar/waitlist/seam-tool.js");
        const out = await handleWaitlistAdd(input.organizationId, p.params, p.idempotency_key);
        results.push({
          action: p.action,
          status: out.status === "success" ? "success" : "error",
          idempotency_key: p.idempotency_key,
        });
      } catch {
        results.push({ action: p.action, status: "error", idempotency_key: p.idempotency_key });
      }
      continue;
    }
    if (p.action === "create-charge") {
      try {
        const { handleCreateCharge } = await import("@/modules/payments/seam-tool.js");
        const out = await handleCreateCharge(input.organizationId, p.params, p.idempotency_key);
        results.push({
          action: p.action,
          status: out.status === "success" ? "success" : "error",
          idempotency_key: p.idempotency_key,
        });
      } catch {
        results.push({ action: p.action, status: "error", idempotency_key: p.idempotency_key });
      }
      continue;
    }
    if (p.action === "create-refund") {
      try {
        const { handleCreateRefund } = await import("@/modules/payments/seam-tool.js");
        const out = await handleCreateRefund(
          input.organizationId,
          p.params,
          p.idempotency_key,
          input.approverClerkUserId,
        );
        results.push({
          action: p.action,
          status: out.status === "success" ? "success" : "error",
          idempotency_key: p.idempotency_key,
        });
      } catch {
        results.push({ action: p.action, status: "error", idempotency_key: p.idempotency_key });
      }
      continue;
    }
    const isCalendar =
      p.action === "create-appointment" ||
      p.action === "reschedule-appointment" ||
      p.action === "cancel-appointment";
    if (!isCalendar) {
      results.push({ action: p.action, status: "deferred", idempotency_key: p.idempotency_key });
      continue;
    }

    const ctx = await resolveConversationCalendarContext(
      input.organizationId,
      input.conversationId,
      p.params,
    );
    if (!ctx) {
      // Contexto não-resolvível (calendar default ausente / conversa
      // inexistente). Honesto: nunca fabrica dados.
      results.push({ action: p.action, status: "error", idempotency_key: p.idempotency_key });
      continue;
    }

    if (p.action === "create-appointment") {
      if (!ctx.serviceId || !ctx.date || !ctx.startTime) {
        // Faltam service_id / start_at parseável → erro honesto.
        results.push({ action: p.action, status: "error", idempotency_key: p.idempotency_key });
        continue;
      }
      // booking pode lançar AppError (notFound: service/calendar stale).
      // O seam captura e reporta como result `error` honesto por-proposal,
      // nunca aborta o batch (preserva o rollup); distinto do slot_conflict
      // §133, que é um RETORNO de BookResult, não exceção.
      try {
        const r = await createAppointment({
          organizationId: input.organizationId,
          calendarId: ctx.calendarId,
          serviceId: ctx.serviceId,
          professionalId: ctx.professionalId ?? null,
          customerId: ctx.customerId ?? null,
          customerName: ctx.customerName ?? null,
          customerPhone: ctx.customerPhone ?? null,
          customerEmail: null,
          date: ctx.date,
          startTime: ctx.startTime,
          source: "ai",
          conversationId: input.conversationId,
          idempotencyKey: p.idempotency_key,
        });
        results.push({
          action: p.action,
          status: r.status === "booked" ? "success" : "slot_conflict",
          appointment_id: r.appointment_id,
          idempotency_key: p.idempotency_key,
        });
      } catch {
        results.push({ action: p.action, status: "error", idempotency_key: p.idempotency_key });
        continue;
      }
    } else if (p.action === "reschedule-appointment") {
      // Guard explícito (sem `!` que possa lançar): reschedule exige
      // appointment_id na proposal. Ausente → erro honesto.
      if (!ctx.appointmentId) {
        results.push({ action: p.action, status: "error", idempotency_key: p.idempotency_key });
        continue;
      }
      // booking.ts.rescheduleAppointment exige start_time real p/ sucesso;
      // sem horário derivável → slot_conflict honesto (carry-forward Task 4).
      // Pode lançar AppError (notFound: appointment stale; conflict: notice-
      // window violada). O seam captura e reporta como result `error` honesto
      // por-proposal, nunca aborta o batch (preserva o rollup); distinto do
      // slot_conflict §133, que é um RETORNO de BookResult, não exceção.
      try {
        const r = await rescheduleAppointment(
          input.organizationId,
          ctx.appointmentId,
          {
            date: ctx.date || undefined,
            start_time: ctx.startTime || undefined,
            professional_id: ctx.professionalId ?? null,
          },
          ctx.calendarTimezone,
        );
        results.push({
          action: p.action,
          status: r.status === "booked" ? "success" : "slot_conflict",
          appointment_id: r.appointment_id,
          idempotency_key: p.idempotency_key,
        });
      } catch {
        results.push({ action: p.action, status: "error", idempotency_key: p.idempotency_key });
        continue;
      }
    } else {
      // cancel-appointment
      if (!ctx.appointmentId) {
        results.push({ action: p.action, status: "error", idempotency_key: p.idempotency_key });
        continue;
      }
      // booking pode lançar AppError (notFound: appointment stale). O seam
      // captura e reporta como result `error` honesto por-proposal, nunca
      // aborta o batch (preserva o rollup); distinto do slot_conflict §133,
      // que é um RETORNO de BookResult, não exceção.
      try {
        await transitionAppointment(
          input.organizationId,
          ctx.appointmentId,
          "cancelled",
          "ai_cancelled",
        );
        results.push({ action: p.action, status: "success", idempotency_key: p.idempotency_key });
      } catch {
        results.push({ action: p.action, status: "error", idempotency_key: p.idempotency_key });
        continue;
      }
    }
  }

  const anyExec = results.some((r) => r.status === "success" || r.status === "slot_conflict");
  const allDeferred = results.every((r) => r.status === "deferred");
  const hasDeferred = results.some((r) => r.status === "deferred");
  return {
    status: allDeferred ? "deferred" : anyExec ? (hasDeferred ? "partial" : "executed") : "partial",
    results,
  };
}

export async function deliverToChannel(input: {
  organizationId: string;
  conversationId: string;
  responseText: string;
  executionId: string;
  // M5-P2a Item 9 — optional AbortSignal threaded por BullMQ worker.
  // Gated por env RETRY_ABORTABLE (default false em V1 — Marco 4 baseline
  // preserved). Quando true + signal provided, retry sleeps são abortable
  // (graceful shutdown vs. up to 7s hang per retry cycle).
  signal?: AbortSignal;
}): Promise<DeliveryResult> {
  // Step 1: empty text guard (cheapest check, no DB roundtrip)
  if (input.responseText.trim().length === 0) {
    await insertMessageAudit({
      organizationId: input.organizationId,
      executionId: input.executionId,
      conversationId: input.conversationId,
      action: "metaapi.send.skipped",
      channel: null,
      // M5-P2a Item 10 — sentinel `'SKIPPED'` para forensic queries:
      // `WHERE error_code IS NOT NULL` agora captura skip paths.
      // `reason` mantém sub-kind (`empty_text|missing_recipient|missing_tenant`).
      // Cross-repo grep gate (spec §10 Risk-6) confirmou ausência de filters
      // que assumam `error_code = 'X'` estrito em consumidores externos.
      errorCode: "SKIPPED",
      reason: "empty_text",
      attemptCount: 0,
    });
    metaapiOutboundMessagesTotal.inc({ channel: "unknown", status: "skipped_empty_text" });
    return { status: "skipped_empty_text" };
  }

  // Step 2: context lookup
  //
  // SEV-L-2 fail-closed decision (M5-P2a Item 11 — spec §4.8 + Agent #3-R3
  // LOW-2): findExecutionDeliveryContext pode throw em DB-unavailable.
  // Decision V1: propagate exception, BullMQ retry com cap
  // (DEFAULT_JOB_OPTIONS em src/lib/queues.ts: attempts=7, backoff
  // exponential 5s base = ~635s total retry window absorve RDS Multi-AZ
  // failover ~60-120s). Rationale: BullMQ retry handles transient DB
  // blips; return failed_rejected aqui mask retryable error e adds
  // double-retry indirection. Após attempts exhausted, BullMQ DLQs job
  // → audit action='retry_exhausted' (entity_type='execution').
  const ctx = await findExecutionDeliveryContext(input.executionId);
  if (!ctx || !ctx.provider || !ctx.customerPhone) {
    await insertMessageAudit({
      organizationId: input.organizationId,
      executionId: input.executionId,
      conversationId: input.conversationId,
      action: "metaapi.send.skipped",
      channel: ctx?.provider ?? null,
      // M5-P2a Item 10 — SKIPPED sentinel (ver step 1 acima).
      errorCode: "SKIPPED",
      reason: "missing_recipient",
      attemptCount: 0,
    });
    metaapiOutboundMessagesTotal.inc({
      channel: ctx?.provider ?? "unknown",
      status: "skipped_missing_recipient",
    });
    return { status: "skipped_missing_recipient" };
  }

  // Step 3: tenant lookup
  //
  // SEV-L-2 fail-closed decision (M5-P2a Item 11 — spec §4.8 + Agent #3-R3
  // LOW-2): findMetaApiTenant pode throw em DB-unavailable. Mesma semantic
  // do step 2 acima: propagate, BullMQ retry com cap absorve transient.
  // Note: label `missing_tenant` retornado no skip path abaixo é distinto
  // de DB-throw — skip path é cleanly null result, throw path é exception
  // → BullMQ retry. Rename `missing_tenant` → `missing_organization` é
  // follow-on glossário cleanup (ver insertMessageAudit reason abaixo).
  const tenantId = await findMetaApiTenant(input.organizationId);
  if (!tenantId) {
    await insertMessageAudit({
      organizationId: input.organizationId,
      executionId: input.executionId,
      conversationId: input.conversationId,
      action: "metaapi.send.skipped",
      channel: ctx.provider,
      // M5-P2a Item 10 — SKIPPED sentinel (ver step 1 acima).
      // Note: label `missing_tenant` é legado pré-canonical-tenancy;
      // rename → `missing_organization` é follow-on M6+ (backward compat
      // com forensic queries existentes pesa sobre glossário cleanup).
      errorCode: "SKIPPED",
      reason: "missing_tenant",
      attemptCount: 0,
    });
    metaapiOutboundMessagesTotal.inc({
      channel: ctx.provider,
      status: "skipped_missing_tenant",
    });
    return { status: "skipped_missing_tenant", organization_id: input.organizationId };
  }

  // Step 4: build payload (guarded by ctx + text checks above; should not return skip)
  const built = validateAndBuild({
    channel: ctx.provider,
    to: ctx.customerPhone,
    from: ctx.externalAccountId ?? undefined,
    responseText: input.responseText,
    executionId: input.executionId,
  });
  if (built.kind !== "ok") {
    // Defensive — race condition or invariant violation
    await insertMessageAudit({
      organizationId: input.organizationId,
      executionId: input.executionId,
      conversationId: input.conversationId,
      action: "metaapi.send.skipped",
      channel: ctx.provider,
      // M5-P2a Item 10 — SKIPPED sentinel (defensive race/invariant guard
      // mas retorna mesmo set de statuses → mesma forensic signature).
      errorCode: "SKIPPED",
      reason: built.reason,
      attemptCount: 0,
    });
    metaapiOutboundMessagesTotal.inc({
      channel: ctx.provider,
      status: `skipped_${built.reason}` as "skipped_empty_text" | "skipped_missing_recipient",
    });
    return built.reason === "empty_text"
      ? { status: "skipped_empty_text" }
      : { status: "skipped_missing_recipient" };
  }

  // Step 5: retry loop (1 initial + up to 3 retries on retryable codes)
  let attempt = 0;
  let lastResult: Awaited<ReturnType<typeof sendMessage>> = {
    status: "error",
    code: "UNKNOWN",
    message: "no attempt yet",
  };
  while (true) {
    const start = Date.now();
    lastResult = await sendMessage({
      metaApiTenantId: tenantId,
      body: built.payload,
      idempotencyKey: built.idempotencyKey,
      requestId: input.executionId,
    });
    const latencyS = (Date.now() - start) / 1000;
    attempt++;
    const latencyStatus = lastResult.status === "sent" ? "sent" : lastResult.code;
    metaapiOutboundLatencySeconds.observe(
      { channel: ctx.provider, status: latencyStatus },
      latencyS,
    );
    if (lastResult.status === "sent") break;
    if (!RETRYABLE_CODES.has(lastResult.code)) break;
    if (attempt > RETRY_DELAYS_MS.length) break;
    metaapiOutboundRetriesTotal.inc({ channel: ctx.provider });
    const delayMs = RETRY_DELAYS_MS[attempt - 1]!;
    // Short-circuit: input.signal undefined em todos callers V1 → branch
    // legado preservado, env() não é tocada (Marco 4 baseline gate).
    // Quando algum caller começa a passar signal, env().RETRY_ABORTABLE
    // governa o opt-in real (staging-first per spec §4.6 cutover).
    if (input.signal && env().RETRY_ABORTABLE) {
      await abortableSleep(delayMs, input.signal);
    } else {
      await sleep(delayMs);
    }
  }

  // Step 6: map outcome
  if (lastResult.status === "sent") {
    // POC fix (Finding HIGH outgoing-messages-not-persisted): persist outgoing
    // message_record para que a IA enxergue o próprio histórico assistant em
    // conversas multi-turno. Inbound path grava em routes.ts:255; outbound era
    // invisível, violando PRD §8.1 passo 9.
    //
    // Idempotency: ON CONFLICT (conversation_key, external_message_id) DO NOTHING
    // garante que retry de approve flow (BullMQ) não duplica linha.
    //
    // Failure mode é NON-FATAL: o envio para Meta já sucedeu (idempotency_key
    // construído cobre o hop externo). Falha em persistir history NÃO deve
    // mascarar o status `sent` nem disparar retry do approve flow (o que
    // reenviaria a mensagem). Erro é logado para observability; follow-on
    // consolidará com inbound path (ver PR body).
    //
    // ConversationKey null = conversa sem conversation_pipeline_state row
    // (synthetic test conversations ou conversa criada fora do inbound flow).
    // Skip honesto — não fabrica chave.
    if (ctx.conversationKey) {
      try {
        await insertMessageRecord({
          // Outbound não tem received_events envelope; coluna FK é nullable
          // (ON DELETE SET NULL no schema). Inbound mantém non-null.
          receivedEventId: null,
          conversationKey: ctx.conversationKey,
          externalMessageId: lastResult.provider_message_id,
          direction: "outgoing",
          contentText: input.responseText,
          messageCreatedAt: new Date().toISOString(),
          senderSnapshotJson: {
            actor: "ai",
            execution_id: input.executionId,
          },
        });
      } catch (err) {
        logger().warn(
          {
            execution_id: input.executionId,
            conversation_id: input.conversationId,
            organization_id: input.organizationId,
            provider_message_id: lastResult.provider_message_id,
            err: err instanceof Error ? err.message : String(err),
          },
          "metaapi.outbound.message_record_persist_failed",
        );
      }
    }

    await insertMessageAudit({
      organizationId: input.organizationId,
      executionId: input.executionId,
      conversationId: input.conversationId,
      action: "metaapi.send.success",
      channel: ctx.provider,
      messageId: lastResult.message_id,
      providerMessageId: lastResult.provider_message_id,
      attemptCount: attempt,
    });
    metaapiOutboundMessagesTotal.inc({ channel: ctx.provider, status: "sent" });
    return {
      status: "sent",
      channel: ctx.provider,
      message_id: lastResult.message_id,
      provider_message_id: lastResult.provider_message_id,
      attempt_count: attempt,
    };
  }

  // lastResult.status === "error"
  const retryable = RETRYABLE_CODES.has(lastResult.code);
  if (retryable) {
    await insertMessageAudit({
      organizationId: input.organizationId,
      executionId: input.executionId,
      conversationId: input.conversationId,
      action: "metaapi.send.error",
      channel: ctx.provider,
      errorCode: lastResult.code,
      reason: lastResult.message,
      attemptCount: attempt,
    });
    metaapiOutboundMessagesTotal.inc({
      channel: ctx.provider,
      status: "failed_retryable_exhausted",
    });
    return {
      status: "failed_retryable_exhausted",
      channel: ctx.provider,
      error_code: lastResult.code,
      last_error_message: lastResult.message,
      attempt_count: attempt,
    };
  }

  // Non-retryable: META_REJECTED / IDEMPOTENCY_CONFLICT / INVALID_INPUT /
  // UNAUTHENTICATED / FORBIDDEN / NOT_FOUND / CONFLICT
  await insertMessageAudit({
    organizationId: input.organizationId,
    executionId: input.executionId,
    conversationId: input.conversationId,
    action: "metaapi.send.error",
    channel: ctx.provider,
    errorCode: lastResult.code,
    reason: lastResult.message,
    attemptCount: attempt,
  });
  metaapiOutboundMessagesTotal.inc({ channel: ctx.provider, status: "failed_rejected" });
  return {
    status: "failed_rejected",
    channel: ctx.provider,
    error_code: lastResult.code,
    error_message: lastResult.message,
  };
}
