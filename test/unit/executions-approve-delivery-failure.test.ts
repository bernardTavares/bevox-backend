/**
 * Unit test: PRD §8.1 delivery failure → execution.status='error'.
 *
 * Cobre os 2 caminhos do achado `complete-ignores-delivery-failure-status-done`:
 *
 *   1. approve / edit (service.ts runApproval): quando deliverToChannel retorna
 *      `failed_rejected` / `failed_retryable_exhausted`, transitionError é chamado
 *      (NÃO transitionApproved); retorno = `{ status: 'error' }`; audit registra
 *      final_status='error' + delivery_status.
 *
 *   2. resolveComplete (complete-service.ts autonomous_supervised reply): quando
 *      deliverToChannel retorna `failed_*`, finalStatus = 'error' (NÃO 'done').
 *
 * Skips (texto vazio / recipient ausente / tenant ausente) NÃO degradam para error
 * — auditados no próprio seam como `metaapi.send.skipped` e mantêm `done`.
 *
 * Mock pattern espelha test/unit/executions-approve-threading.test.ts (vi.hoisted).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { DeliveryResult } from "@/modules/executions/seams.js";
import type * as executionsSeamsTypes from "@/modules/executions/seams.js";

// NOTE vitest 4.x: use vi.hoisted para os mocks referenciados no factory de vi.mock.
// `deliverToChannel` é tipado explicitamente para DeliveryResult: sem isso, TS
// infere `{ status: string }` a partir do default e rejeita os campos `channel`,
// `error_code`, etc. nas variantes `failed_*` e `sent` dos `mockResolvedValueOnce`.
const mocks = vi.hoisted(() => ({
  executeProposals: vi.fn(async () => ({ status: "executed", results: [] })),
  deliverToChannel: vi.fn<() => Promise<DeliveryResult>>(async () => ({
    status: "skipped_empty_text",
  })),
  findApprovable: vi.fn(),
  insertApprovalAudit: vi.fn(async () => undefined),
  listPendingApprovals: vi.fn(),
  transitionApproved: vi.fn(async () => true),
  transitionError: vi.fn(async () => true),
  transitionRejected: vi.fn(),
  findExecutionContext: vi.fn(async () => ({ conversation_id: "conv-1" })),
  escalateConversationRequestHuman: vi.fn(async () => undefined),
  publishRealtime: vi.fn(async () => undefined),
}));
vi.mock("@/modules/executions/seams.js", async () => {
  // Preserve isDeliveryFailure helper (regra centralizada) — única função que NÃO mockamos.
  const actual = await vi.importActual<typeof executionsSeamsTypes>(
    "@/modules/executions/seams.js",
  );
  return {
    ...actual,
    executeProposals: mocks.executeProposals,
    deliverToChannel: mocks.deliverToChannel,
  };
});
vi.mock("@/modules/executions/repository.js", () => ({
  findApprovable: mocks.findApprovable,
  insertApprovalAudit: mocks.insertApprovalAudit,
  listPendingApprovals: mocks.listPendingApprovals,
  transitionApproved: mocks.transitionApproved,
  transitionError: mocks.transitionError,
  transitionRejected: mocks.transitionRejected,
}));
vi.mock("@/integration/harness-callbacks.repository.js", () => ({
  findExecutionContext: mocks.findExecutionContext,
  escalateConversationRequestHuman: mocks.escalateConversationRequestHuman,
}));
vi.mock("@/modules/realtime/publish.js", () => ({
  publishRealtime: mocks.publishRealtime,
}));

import { approve, edit } from "@/modules/executions/service.js";
import { resolveComplete } from "@/modules/executions/complete-service.js";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.findApprovable.mockResolvedValue({
    status: "waiting_approval",
    conversation_id: "conv-1",
    result_payload: {
      response_text: "ok",
      proposals: [],
    },
  });
  mocks.transitionApproved.mockResolvedValue(true);
  mocks.transitionError.mockResolvedValue(true);
  mocks.findExecutionContext.mockResolvedValue({ conversation_id: "conv-1" });
});

describe("PRD §8.1 — approve/edit honra delivery failure → status='error'", () => {
  it("approve com delivery.failed_rejected → transitionError (não transitionApproved), retorna status='error'", async () => {
    mocks.deliverToChannel.mockResolvedValueOnce({
      status: "failed_rejected",
      channel: "whatsapp",
      error_code: "META_REJECTED",
      error_message: "recipient blocked",
    });

    const result = await approve("org-1", "ex-1", "clerk_approver");

    expect(result).toEqual({ id: "ex-1", status: "error" });
    expect(mocks.transitionError).toHaveBeenCalledTimes(1);
    expect(mocks.transitionApproved).not.toHaveBeenCalled();
    // O delivery payload completo é persistido para forensic (error_code + channel).
    expect(mocks.transitionError).toHaveBeenCalledWith(
      "org-1",
      "ex-1",
      expect.objectContaining({
        delivery: expect.objectContaining({
          status: "failed_rejected",
          error_code: "META_REJECTED",
        }),
      }),
    );
    // Audit registra final_status='error' + delivery_status p/ forensic.
    expect(mocks.insertApprovalAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "execution.approved",
        afterJson: expect.objectContaining({
          final_status: "error",
          delivery_status: "failed_rejected",
        }),
      }),
    );
  });

  it("approve com delivery.failed_retryable_exhausted → transitionError, status='error'", async () => {
    mocks.deliverToChannel.mockResolvedValueOnce({
      status: "failed_retryable_exhausted",
      channel: "whatsapp",
      error_code: "META_UNAVAILABLE",
      last_error_message: "503 upstream",
      attempt_count: 4,
    });

    const result = await approve("org-1", "ex-1", "clerk_approver");

    expect(result).toEqual({ id: "ex-1", status: "error" });
    expect(mocks.transitionError).toHaveBeenCalledTimes(1);
    expect(mocks.transitionApproved).not.toHaveBeenCalled();
  });

  it("edit com delivery.failed_rejected → transitionError, status='error'", async () => {
    mocks.deliverToChannel.mockResolvedValueOnce({
      status: "failed_rejected",
      channel: "whatsapp",
      error_code: "META_REJECTED",
      error_message: "blocked",
    });

    const result = await edit("org-1", "ex-1", { response_text: "edited text" }, "clerk_approver");

    expect(result).toEqual({ id: "ex-1", status: "error" });
    expect(mocks.transitionError).toHaveBeenCalledTimes(1);
    expect(mocks.insertApprovalAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "execution.edited",
        afterJson: expect.objectContaining({
          final_status: "error",
          edited: true,
        }),
      }),
    );
  });

  it("approve com delivery.sent → transitionApproved (caminho feliz preservado)", async () => {
    mocks.deliverToChannel.mockResolvedValueOnce({
      status: "sent",
      channel: "whatsapp",
      message_id: "msg-1",
      provider_message_id: "wamid.1",
      attempt_count: 1,
    });

    const result = await approve("org-1", "ex-1", "clerk_approver");

    expect(result).toEqual({ id: "ex-1", status: "done" });
    expect(mocks.transitionApproved).toHaveBeenCalledTimes(1);
    expect(mocks.transitionError).not.toHaveBeenCalled();
  });

  it("approve com delivery.skipped_empty_text → mantém 'done' (skip é no-op intencional)", async () => {
    mocks.deliverToChannel.mockResolvedValueOnce({ status: "skipped_empty_text" });

    const result = await approve("org-1", "ex-1", "clerk_approver");

    expect(result).toEqual({ id: "ex-1", status: "done" });
    expect(mocks.transitionApproved).toHaveBeenCalledTimes(1);
    expect(mocks.transitionError).not.toHaveBeenCalled();
  });

  it("approve com delivery.skipped_missing_recipient → mantém 'done'", async () => {
    mocks.deliverToChannel.mockResolvedValueOnce({ status: "skipped_missing_recipient" });

    const result = await approve("org-1", "ex-1", "clerk_approver");

    expect(result).toEqual({ id: "ex-1", status: "done" });
    expect(mocks.transitionApproved).toHaveBeenCalledTimes(1);
    expect(mocks.transitionError).not.toHaveBeenCalled();
  });
});

describe("PRD §8.1 — resolveComplete (autonomous_supervised reply) honra delivery failure", () => {
  it("autonomous_supervised + reply + delivery.failed_rejected → finalStatus='error'", async () => {
    mocks.deliverToChannel.mockResolvedValueOnce({
      status: "failed_rejected",
      channel: "whatsapp",
      error_code: "META_REJECTED",
      error_message: "recipient blocked",
    });

    const outcome = await resolveComplete({
      organizationId: "org-1",
      executionId: "ex-1",
      executionMode: "autonomous_supervised",
      strategy: "react",
      responseText: "hello",
      proposals: [],
    });

    expect(outcome.finalStatus).toBe("error");
    expect(outcome.suggestionType).toBe("reply");
    // delivery payload preservado em resultPayloadExtra p/ forensic.
    expect(outcome.resultPayloadExtra).toMatchObject({
      delivery: expect.objectContaining({
        status: "failed_rejected",
        error_code: "META_REJECTED",
      }),
    });
  });

  it("autonomous_supervised + reply + delivery.failed_retryable_exhausted → finalStatus='error'", async () => {
    mocks.deliverToChannel.mockResolvedValueOnce({
      status: "failed_retryable_exhausted",
      channel: "whatsapp",
      error_code: "META_UNAVAILABLE",
      last_error_message: "503",
      attempt_count: 4,
    });

    const outcome = await resolveComplete({
      organizationId: "org-1",
      executionId: "ex-1",
      executionMode: "autonomous_supervised",
      strategy: "react",
      responseText: "hello",
      proposals: [],
    });

    expect(outcome.finalStatus).toBe("error");
  });

  it("autonomous_supervised + reply + delivery.sent → finalStatus='done' (caminho feliz preservado)", async () => {
    mocks.deliverToChannel.mockResolvedValueOnce({
      status: "sent",
      channel: "whatsapp",
      message_id: "msg-1",
      provider_message_id: "wamid.1",
      attempt_count: 1,
    });

    const outcome = await resolveComplete({
      organizationId: "org-1",
      executionId: "ex-1",
      executionMode: "autonomous_supervised",
      strategy: "react",
      responseText: "hello",
      proposals: [],
    });

    expect(outcome.finalStatus).toBe("done");
  });

  it("autonomous_supervised + reply + delivery.skipped_empty_text → finalStatus='done' (skip = no-op)", async () => {
    mocks.deliverToChannel.mockResolvedValueOnce({ status: "skipped_empty_text" });

    const outcome = await resolveComplete({
      organizationId: "org-1",
      executionId: "ex-1",
      executionMode: "autonomous_supervised",
      strategy: "react",
      responseText: "",
      proposals: [],
    });

    expect(outcome.finalStatus).toBe("done");
  });
});
