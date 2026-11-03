import { describe, expect, it } from "vitest";
import { inferSuggestionType } from "@/modules/executions/complete-service.js";

describe("inferSuggestionType (ADR-007 §6 + P3b money-safety)", () => {
  it("sem proposal → reply", () => {
    expect(inferSuggestionType("react", [])).toBe("reply");
  });
  it("create/reschedule/cancel-appointment → slot", () => {
    for (const a of ["create-appointment", "reschedule-appointment", "cancel-appointment"]) {
      expect(inferSuggestionType("plan-execute", [{ action: a }])).toBe("slot");
    }
  });
  it("create-charge → charge", () => {
    expect(inferSuggestionType("react", [{ action: "create-charge" }])).toBe("charge");
  });
  it("create-refund → refund", () => {
    expect(inferSuggestionType("react", [{ action: "create-refund" }])).toBe("refund");
  });
  it("money-safety: refund/charge em QUALQUER posição força money type (não só [0])", () => {
    expect(
      inferSuggestionType("react", [{ action: "send-message" }, { action: "create-refund" }]),
    ).toBe("refund");
    expect(
      inferSuggestionType("react", [{ action: "send-message" }, { action: "create-charge" }]),
    ).toBe("charge");
    expect(
      inferSuggestionType("react", [{ action: "create-charge" }, { action: "create-refund" }]),
    ).toBe("refund");
  });
  it("send-message proposal → reply (ADR-006 §89)", () => {
    expect(inferSuggestionType("direct", [{ action: "send-message" }])).toBe("reply");
  });
  it("strategy request-human → null (escala, não retém)", () => {
    expect(inferSuggestionType("request-human", [])).toBeNull();
  });
  it("strategy workflow (caminho SDR Model-C) → reply quando sem proposal", () => {
    expect(inferSuggestionType("workflow", [])).toBe("reply");
  });
  it("strategy workflow + create-appointment proposal → slot", () => {
    expect(inferSuggestionType("workflow", [{ action: "create-appointment" }])).toBe("slot");
  });
});
