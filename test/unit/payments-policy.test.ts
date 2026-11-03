import { describe, expect, it } from "vitest";

import { validatePaymentPolicyPatch } from "@/modules/payments/policy.js";

describe("validatePaymentPolicyPatch (Zod strict, política per-org)", () => {
  it("aceita no_show_consumes_session boolean", () => {
    const r = validatePaymentPolicyPatch({ no_show_consumes_session: true });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.no_show_consumes_session).toBe(true);
  });
  it("rejeita platform_fee_percent (Bevox-only → chave desconhecida sob strict)", () => {
    expect(validatePaymentPolicyPatch({ platform_fee_percent: 0 }).success).toBe(false);
  });
  it("rejeita chaves desconhecidas", () => {
    expect(validatePaymentPolicyPatch({ no_show_consumes_session: true, foo: 1 }).success).toBe(
      false,
    );
  });
  it("rejeita patch vazio (precisa ≥1 chave conhecida)", () => {
    expect(validatePaymentPolicyPatch({}).success).toBe(false);
  });
  it("rejeita no_show não-boolean", () => {
    expect(validatePaymentPolicyPatch({ no_show_consumes_session: "yes" }).success).toBe(false);
  });
});
