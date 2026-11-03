/**
 * Aprovação sobre a execução (bevox-backend/ADR-019 — supersedes hub ADR-025). approve/edit → seams + done;
 * reject → rejected. Idempotente: a transição só dispara de
 * waiting_approval (reaplicar = 409 conflict).
 */
import { errors } from "@/shared/errors.js";
import { deliverToChannel, executeProposals, isDeliveryFailure, type Proposal } from "./seams.js";
import {
  findApprovable,
  insertApprovalAudit,
  listPendingApprovals,
  transitionApproved,
  transitionError,
  transitionRejected,
} from "./repository.js";
import type { EditBody, RejectBody } from "./schemas.js";

export async function list(
  orgId: string,
  status: string | undefined,
  suggestionType: string | undefined,
) {
  return { items: await listPendingApprovals(orgId, status, suggestionType) };
}

async function runApproval(
  orgId: string,
  id: string,
  clerkUserId: string | null,
  responseTextOverride: string | undefined,
  action: "execution.approved" | "execution.edited",
) {
  const row = await findApprovable(orgId, id);
  if (!row) throw errors.notFound("Execution", id);
  if (row.status !== "waiting_approval") {
    throw errors.conflict("Execution is not awaiting approval", { execution_id: id });
  }
  const payload = (row.result_payload ?? {}) as Record<string, unknown>;
  const responseText =
    responseTextOverride ??
    (typeof payload["response_text"] === "string" ? (payload["response_text"] as string) : "");
  const proposals = (Array.isArray(payload["proposals"]) ? payload["proposals"] : []) as Proposal[];

  // NOTE (M3): os seams rodam ANTES do UPDATE guardado; sob concorrência dois
  // aprovadores passam o check de status e ambos chegam aqui. Seguro hoje
  // (seams são no-op). Quando executeProposals/deliverToChannel virarem reais
  // (M3/M4), exactly-once depende de Proposal.idempotency_key — NÃO deste read
  // de status nem do plugin requireIdempotency (que chaveia por header do
  // cliente e não serializa aprovadores concorrentes).
  const proposalExecution = await executeProposals({
    organizationId: orgId,
    executionId: id,
    conversationId: row.conversation_id,
    proposals,
    approverClerkUserId: clerkUserId ?? undefined, // P3b: o aprovador humano (audit do refund)
  });
  // ADR-011 §133 / PRD §8.2: slot ocupado entre a IA propor e o humano
  // aprovar → NÃO aprovar; 409 p/ a UI pedir nova sugestão. A execução
  // permanece waiting_approval (NÃO chama transitionApproved); como o
  // seam roda ANTES do UPDATE guardado, nenhuma transição vazou.
  const conflict = proposalExecution.results.find((r) => r.status === "slot_conflict");
  if (conflict) {
    throw errors.conflict("slot_conflict", { execution_id: id, action: conflict.action });
  }
  // M4: quando deliverToChannel virar envio real, responseText vazio (approve
  // sem texto canônico) NÃO deve produzir outbound — guardar/decidir semântica
  // no spec do M4.
  const delivery = await deliverToChannel({
    organizationId: orgId,
    conversationId: row.conversation_id,
    responseText,
    executionId: id,
  });
  const nextPayload = {
    ...payload,
    response_text: responseText,
    proposal_execution: proposalExecution,
    delivery,
  };

  // PRD §8.1: approve/edit pode falhar na ENTREGA outbound mesmo com seams
  // OK (META rejeitou / retries exauridos). Nesse caso, a execução transiciona
  // p/ `error` — NÃO `done` (delivery payload completo em result_payload p/
  // forensic). Skips (texto vazio / recipient ausente / tenant ausente) são
  // no-op intencional auditados no próprio seam → mantêm `done`.
  // Follow-on: retry queue + SSE event de status='error' (não neste POC).
  if (isDeliveryFailure(delivery)) {
    const wonError = await transitionError(orgId, id, nextPayload);
    if (!wonError) {
      throw errors.conflict("Execution is not awaiting approval", { execution_id: id });
    }
    await insertApprovalAudit({
      organizationId: orgId,
      executionId: id,
      action,
      actorType: "user",
      afterJson: {
        final_status: "error",
        actor_clerk_id: clerkUserId,
        edited: action === "execution.edited",
        delivery_status: delivery.status,
      },
    });
    return { id, status: "error" as const };
  }

  const won = await transitionApproved(orgId, id, nextPayload);
  if (!won) throw errors.conflict("Execution is not awaiting approval", { execution_id: id });

  await insertApprovalAudit({
    organizationId: orgId,
    executionId: id,
    action,
    actorType: "user",
    afterJson: {
      final_status: "done",
      actor_clerk_id: clerkUserId,
      edited: action === "execution.edited",
    },
  });
  return { id, status: "done" as const };
}

export function approve(orgId: string, id: string, clerkUserId: string | null) {
  return runApproval(orgId, id, clerkUserId, undefined, "execution.approved");
}

export function edit(orgId: string, id: string, body: EditBody, clerkUserId: string | null) {
  return runApproval(orgId, id, clerkUserId, body.response_text, "execution.edited");
}

export async function reject(
  orgId: string,
  id: string,
  body: RejectBody,
  clerkUserId: string | null,
) {
  const row = await findApprovable(orgId, id);
  if (!row) throw errors.notFound("Execution", id);
  if (row.status !== "waiting_approval") {
    throw errors.conflict("Execution is not awaiting approval", { execution_id: id });
  }
  const won = await transitionRejected(orgId, id);
  if (!won) throw errors.conflict("Execution is not awaiting approval", { execution_id: id });
  await insertApprovalAudit({
    organizationId: orgId,
    executionId: id,
    action: "execution.rejected",
    actorType: "user",
    reasonText: body.rejection_reason_text ?? null,
    afterJson: {
      final_status: "rejected",
      rejection_reason_code: body.rejection_reason_code,
      actor_clerk_id: clerkUserId,
    },
  });
  return { id, status: "rejected" as const };
}
