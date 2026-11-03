import { describe, expect, it } from "vitest";
import { ProposalSchema, StatusCallbackSchema } from "@/integration/harness-callbacks.schema.js";

describe("ProposalSchema action enum (P3b)", () => {
  it("aceita create-refund", () => {
    expect(
      ProposalSchema.safeParse({
        action: "create-refund",
        params: { charge_id: "x", amount: 10, reason_code: "duplicate" },
        idempotency_key: "k1",
      }).success,
    ).toBe(true);
  });
  it("segue aceitando create-charge", () => {
    expect(
      ProposalSchema.safeParse({ action: "create-charge", params: {}, idempotency_key: "k" })
        .success,
    ).toBe(true);
  });
  it("rejeita create-package (não é ação distinta = create-charge(package))", () => {
    expect(
      ProposalSchema.safeParse({ action: "create-package", params: {}, idempotency_key: "k" })
        .success,
    ).toBe(false);
  });
});

// Dispatch-contract amendment (canon PRD §10.4, aceito 2026-06-03): the harness
// emits PATCH /status='dead_letter' on attempts-exhaustion.
describe("StatusCallbackSchema — dead_letter (amendment 2026-06-03)", () => {
  it("aceita dead_letter", () => {
    expect(StatusCallbackSchema.safeParse({ status: "dead_letter" }).success).toBe(true);
  });
  it.each(["running", "paused", "cancelled"])("segue aceitando %s", (s) => {
    expect(StatusCallbackSchema.safeParse({ status: s }).success).toBe(true);
  });
  it("rejeita status desconhecido", () => {
    expect(StatusCallbackSchema.safeParse({ status: "bogus" }).success).toBe(false);
  });
});
