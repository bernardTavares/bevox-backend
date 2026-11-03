import { beforeEach, describe, expect, it, vi } from "vitest";

// NOTE vitest 4.x: use vi.hoisted para os mocks referenciados no factory de vi.mock.
const mocks = vi.hoisted(() => ({
  executeProposals: vi.fn(async () => ({ status: "executed", results: [] })),
  deliverToChannel: vi.fn(async () => ({ status: "skipped_empty_text" })),
  findApprovable: vi.fn(),
  insertApprovalAudit: vi.fn(async () => undefined),
  listPendingApprovals: vi.fn(),
  transitionApproved: vi.fn(async () => true),
  transitionError: vi.fn(async () => true),
  transitionRejected: vi.fn(),
}));
vi.mock("@/modules/executions/seams.js", async () => {
  // Preserve isDeliveryFailure helper (regra centralizada PRD §8.1).
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

import { approve } from "@/modules/executions/service.js";
import type * as executionsSeamsTypes from "@/modules/executions/seams.js";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.findApprovable.mockResolvedValue({
    status: "waiting_approval",
    conversation_id: "conv-1",
    result_payload: {
      response_text: "ok",
      proposals: [{ action: "create-refund", params: { charge_id: "c" }, idempotency_key: "k" }],
    },
  });
  mocks.transitionApproved.mockResolvedValue(true);
});

describe("runApproval threads the approver (P3b)", () => {
  it("passa approverClerkUserId = o clerk do aprovador", async () => {
    await approve("org-1", "ex-1", "clerk_approver");
    expect(mocks.executeProposals).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-1",
        executionId: "ex-1",
        conversationId: "conv-1",
        approverClerkUserId: "clerk_approver",
      }),
    );
  });
  it("clerk null → approverClerkUserId undefined", async () => {
    await approve("org-1", "ex-1", null);
    expect(mocks.executeProposals).toHaveBeenCalledWith(
      expect.objectContaining({ approverClerkUserId: undefined }),
    );
  });
});
