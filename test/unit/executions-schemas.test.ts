import { describe, expect, it } from "vitest";
import { rejectBodySchema, editBodySchema, listQuerySchema } from "@/modules/executions/schemas.js";

describe("executions approval schemas", () => {
  it("reject exige rejection_reason_code", () => {
    expect(rejectBodySchema.safeParse({}).success).toBe(false);
    expect(rejectBodySchema.safeParse({ rejection_reason_code: "off_topic" }).success).toBe(true);
  });
  it("edit exige response_text", () => {
    expect(editBodySchema.safeParse({}).success).toBe(false);
    expect(editBodySchema.safeParse({ response_text: "novo" }).success).toBe(true);
  });
  it("listQuery aceita status/suggestion_type opcionais", () => {
    expect(listQuerySchema.safeParse({}).success).toBe(true);
    expect(
      listQuerySchema.safeParse({ status: "waiting_approval", suggestion_type: "reply" }).success,
    ).toBe(true);
  });
});

describe("listQuerySchema suggestion_type (P3b)", () => {
  it("aceita refund", () => {
    expect(listQuerySchema.safeParse({ suggestion_type: "refund" }).success).toBe(true);
  });
  it("segue aceitando reply/slot/charge", () => {
    for (const t of ["reply", "slot", "charge"]) {
      expect(listQuerySchema.safeParse({ suggestion_type: t }).success).toBe(true);
    }
  });
  it("rejeita valor fora do enum", () => {
    expect(listQuerySchema.safeParse({ suggestion_type: "bogus" }).success).toBe(false);
  });
});
