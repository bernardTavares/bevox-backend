import { describe, expect, it } from "vitest";
import { executeProposals } from "@/modules/executions/seams.js";

describe("executeProposals — waitlist-add (param guard, sem DB)", () => {
  it("waitlist-add sem calendar_id → error honesto, sem DB", async () => {
    const r = await executeProposals({
      organizationId: "org-1",
      executionId: "ex-1",
      conversationId: "c-1",
      proposals: [{ action: "waitlist-add", params: {}, idempotency_key: "k1" }],
    });
    expect(r.results).toHaveLength(1);
    expect(r.results.map((x) => x.status)).toEqual(["error"]);
    expect(r.results.map((x) => x.idempotency_key)).toEqual(["k1"]);
  });

  it("ação desconhecida continua deferred honesto (regressão)", async () => {
    const r = await executeProposals({
      organizationId: "o",
      executionId: "e",
      conversationId: "c",
      proposals: [{ action: "send-message", params: {}, idempotency_key: "k2" }],
    });
    expect(r.results.map((x) => x.status)).toEqual(["deferred"]);
  });
});
