/**
 * Algoritmo /complete ADR-007 §6, operando sobre a EXECUÇÃO (ADR-019 —
 * sem entidade AISuggestion). O bloco Marco-1 (lock/finalize/audit) é
 * PRESERVADO na rota; este serviço roda DEPOIS, decidindo entrega vs
 * retenção e disparando realtime/escala.
 */
import {
  escalateConversationRequestHuman,
  findExecutionContext,
} from "@/integration/harness-callbacks.repository.js";
import { publishRealtime } from "@/modules/realtime/publish.js";

import { deliverToChannel, executeProposals, isDeliveryFailure, type Proposal } from "./seams.js";

export type SuggestionType = "reply" | "slot" | "charge" | "refund";

export function inferSuggestionType(
  strategy: string,
  proposals: Array<{ action: string }>,
): SuggestionType | null {
  if (strategy === "request-human") return null;
  if (proposals.length === 0) return "reply";
  // P3b money-safety: QUALQUER ação de dinheiro força tipo não-`reply` (→ waiting_approval,
  // nunca auto-executa em autonomous_supervised), independente da posição. refund > charge > slot > reply.
  if (proposals.some((p) => p.action === "create-refund")) return "refund";
  if (proposals.some((p) => p.action === "create-charge")) return "charge";
  const a = proposals[0]!.action;
  if (a === "create-appointment" || a === "reschedule-appointment" || a === "cancel-appointment") {
    return "slot";
  }
  return "reply";
}

export interface CompleteOutcome {
  finalStatus: "done" | "waiting_approval" | "error";
  suggestionType: SuggestionType | null;
  resultPayloadExtra: Record<string, unknown>;
}

/**
 * Decide o desfecho ADR-007 §6. NÃO faz o UPDATE final (a rota chama
 * finalizeCompletion Marco-1 com finalStatus + result_payload montado).
 *  - request-human → escala conversa, finalStatus 'done', sem retenção.
 *  - autonomous_supervised & reply → seams (deferred/recorded), 'done'.
 *  - senão → 'waiting_approval' + publishRealtime('execution.updated').
 */
export async function resolveComplete(input: {
  organizationId: string;
  executionId: string;
  executionMode: "manual_assisted" | "copilot" | "autonomous_supervised";
  strategy: string;
  responseText: string;
  proposals: Proposal[];
}): Promise<CompleteOutcome> {
  const suggestionType = inferSuggestionType(input.strategy, input.proposals);
  const ctx = await findExecutionContext(input.executionId);
  const conversationId = ctx?.conversation_id ?? "";

  if (suggestionType === null) {
    if (conversationId) {
      await escalateConversationRequestHuman({
        organizationId: input.organizationId,
        conversationId,
        executionId: input.executionId,
      });
      return {
        finalStatus: "done",
        suggestionType: null,
        resultPayloadExtra: { escalated: "request_human" },
      };
    }
    // conversation_id é NOT NULL no schema (executions); este ramo é
    // inalcançável na prática. Se alcançado, NÃO mentir no rastro: registrar
    // que a escala foi pulada por ausência de conversa.
    return {
      finalStatus: "done",
      suggestionType: null,
      resultPayloadExtra: { escalated: "skipped_no_conversation" },
    };
  }

  if (input.executionMode === "autonomous_supervised" && suggestionType === "reply") {
    const proposalExecution = await executeProposals({
      organizationId: input.organizationId,
      executionId: input.executionId,
      conversationId,
      proposals: input.proposals,
    });
    const delivery = await deliverToChannel({
      organizationId: input.organizationId,
      conversationId,
      responseText: input.responseText,
      executionId: input.executionId,
    });
    // PRD §8.1: entrega falha (META rejeitou / retries exauridos) → execution
    // transiciona para 'error', NÃO 'done'. Skips (texto vazio / recipient /
    // tenant ausente) são no-op intencional e MANTÊM 'done' — auditados no
    // próprio seam como `metaapi.send.skipped`. O delivery payload completo
    // permanece em result_payload p/ forensic (error_code + attempt_count).
    const finalStatus: "done" | "error" = isDeliveryFailure(delivery) ? "error" : "done";
    return {
      finalStatus,
      suggestionType,
      resultPayloadExtra: {
        suggestion_type: suggestionType,
        proposal_execution: proposalExecution,
        delivery,
      },
    };
  }

  await publishRealtime(input.organizationId, "execution.updated", {
    execution_id: input.executionId,
    status: "waiting_approval",
    suggestion_type: suggestionType,
  });
  return {
    finalStatus: "waiting_approval",
    suggestionType,
    resultPayloadExtra: { suggestion_type: suggestionType },
  };
}
