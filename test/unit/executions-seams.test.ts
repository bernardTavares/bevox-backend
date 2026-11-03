import { describe, expect, it } from "vitest";
import { executeProposals } from "@/modules/executions/seams.js";

describe("executeProposals (M3-C1: calendar real, demais deferred honesto)", () => {
  it("create-charge é absorvido (não mais deferred): params inválidos → error honesto sem IO", async () => {
    // create-charge agora tenta execução: ChargeProposalSchema.safeParse
    // falha com params:{} ANTES de qualquer IO ⇒ status 'error' (não
    // 'deferred', não 'success'). send-message segue M4 → deferred.
    const r = await executeProposals({
      organizationId: "org-1",
      executionId: "ex-1",
      conversationId: "c-1",
      proposals: [
        { action: "create-charge", params: {}, idempotency_key: "k1" },
        { action: "send-message", params: {}, idempotency_key: "k2" },
      ],
    });
    expect(r.results).toHaveLength(2);
    const byKey = Object.fromEntries(r.results.map((x) => [x.idempotency_key, x.status]));
    expect(byKey["k1"]).toBe("error");
    expect(byKey["k2"]).toBe("deferred");
    expect(r.status).toBe("partial");
  });
  it("create-refund params:{} → error honesto sem IO (charge_id ausente)", async () => {
    const r = await executeProposals({
      organizationId: "org-1",
      executionId: "ex-1",
      conversationId: "c-1",
      proposals: [{ action: "create-refund", params: {}, idempotency_key: "kr" }],
    });
    expect(r.results).toHaveLength(1);
    expect(r.results[0]!.status).toBe("error");
    expect(r.results[0]!.idempotency_key).toBe("kr");
  });
  it("proposals vazias → deferred sem results", async () => {
    const r = await executeProposals({
      organizationId: "o",
      executionId: "e",
      conversationId: "c",
      proposals: [],
    });
    expect(r.status).toBe("deferred");
    expect(r.results).toHaveLength(0);
  });
});
