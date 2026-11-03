/**
 * 6 ações manuais (B4 — Módulo 17).
 * Reconciliação documentada no plano. Todas: reason obrigatório (route
 * valida), status-guard → 409, ledger+audit+realtime.
 *
 * Ordering: toda ação faz o(s) side-effect(s) de domínio durável(eis) e
 * CHAMA `ledger()` por ÚLTIMO. O ordering é proposital — o audit reflete
 * realidade já aplicada e nunca audita uma ação não-aplicada.
 *
 * Janela de falha parcial NÃO-transacional (sem tx helper no codebase —
 * mesmo padrão de handoffConversationOnTimeout / redispatchExecution): se
 * uma mutação de domínio commita e `ledger()` falha depois, a transição
 * staff cross-org fica SEM linha em staff_manual_actions/audit_events —
 * perda de rastro de uma ação sensível parcialmente aplicada.
 * `writeManualActionAndAudit` é ele próprio 3 writes sequenciais não-tx
 * (staff_manual_actions + audit_events + realtime), ampliando a janela.
 * Follow-on: envolver em transação quando existir tx helper compartilhado
 * (paridade com a nota de handoffConversationOnTimeout).
 */
import { errors } from "@/shared/errors.js";
import {
  clearPipelineLease,
  findExecutionForAction,
  guardedSetStatus,
  redispatchExecution,
  setConversationWaitingHuman,
  writeManualActionAndAudit,
  type OpsExecutionRow,
} from "./actions.repository.js";

async function loaded(id: string): Promise<OpsExecutionRow> {
  const row = await findExecutionForAction(id);
  if (!row) throw errors.notFound("Execution", id);
  return row;
}

/**
 * ÚLTIMO passo de toda ação (após o side-effect de domínio durável) e
 * locus da janela de falha parcial não-transacional documentada na nota
 * de módulo: se este `ledger()` falhar, a transição staff já aplicada
 * fica sem rastro em staff_manual_actions/audit_events.
 */
async function ledger(
  row: OpsExecutionRow,
  actionType: string,
  reason: string,
  actorStaffId: string,
  snapshot: Record<string, unknown>,
) {
  await writeManualActionAndAudit({
    organizationId: row.organization_id,
    executionId: row.id,
    bufferWindowId: row.buffer_window_id,
    actionType,
    reason,
    actorStaffId,
    requestPayload: { reason },
    resultSnapshot: snapshot,
  });
}

export async function replay(id: string, reason: string, actorStaffId: string) {
  const row = await loaded(id);
  if (!["error", "dead_letter"].includes(row.status)) {
    throw errors.conflict("Execution cannot be replayed", { execution_id: id, status: row.status });
  }
  const newId = await redispatchExecution(row);
  await ledger(row, "replay", reason, actorStaffId, { new_execution_id: newId });
  return { ok: true, new_execution_id: newId };
}

export async function deadLetterReplay(id: string, reason: string, actorStaffId: string) {
  const row = await loaded(id);
  if (row.status !== "dead_letter") {
    throw errors.conflict("Execution is not a dead letter", {
      execution_id: id,
      status: row.status,
    });
  }
  const newId = await redispatchExecution(row);
  await ledger(row, "dead_letter_replay", reason, actorStaffId, { new_execution_id: newId });
  return { ok: true, new_execution_id: newId };
}

export async function cancel(id: string, reason: string, actorStaffId: string) {
  const row = await loaded(id);
  const won = await guardedSetStatus(id, ["dispatching", "processing"], "cancelled");
  if (!won)
    throw errors.conflict("Execution cannot be cancelled", {
      execution_id: id,
      status: row.status,
    });
  await ledger(row, "cancel", reason, actorStaffId, { status: "cancelled" });
  return { ok: true };
}

export async function overrideAi(id: string, reason: string, actorStaffId: string) {
  const row = await loaded(id);
  if (["dispatching", "processing"].includes(row.status)) {
    await guardedSetStatus(id, ["dispatching", "processing"], "cancelled");
  }
  const newId = await redispatchExecution(row);
  await ledger(row, "override_ai", reason, actorStaffId, { new_execution_id: newId });
  return { ok: true, new_execution_id: newId };
}

export async function overrideHuman(id: string, reason: string, actorStaffId: string) {
  const row = await loaded(id);
  await setConversationWaitingHuman(row.conversation_id);
  if (["dispatching", "processing"].includes(row.status)) {
    await guardedSetStatus(id, ["dispatching", "processing"], "cancelled");
  }
  await ledger(row, "override_human", reason, actorStaffId, { conversation: "waiting_human" });
  return { ok: true };
}

export async function unlock(id: string, reason: string, actorStaffId: string) {
  const row = await loaded(id);
  await clearPipelineLease(row.conversation_id);
  if (row.status === "processing") {
    await guardedSetStatus(id, ["processing"], "error");
  }
  await ledger(row, "unlock", reason, actorStaffId, { lease: "cleared" });
  return { ok: true };
}
