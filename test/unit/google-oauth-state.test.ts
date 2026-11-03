import { UnsecuredJWT } from "jose";
import { describe, expect, it } from "vitest";

import { signOAuthState, verifyOAuthState } from "@/modules/calendar/google/oauth.js";

const SECRET = "test-staff-secret-xyz";

describe("google oauth state JWT (jose HS256)", () => {
  it("sign→verify round-trip carrega claims", async () => {
    const tok = await signOAuthState(
      {
        organization_id: "o1",
        calendar_id: "c1",
        professional_id: null,
        user_id: "u1",
        nonce: "n1",
      },
      SECRET,
      600,
    );
    const claims = await verifyOAuthState(tok, SECRET);
    expect(claims.organization_id).toBe("o1");
    expect(claims.nonce).toBe("n1");
    expect(claims.calendar_id).toBe("c1");
    expect(claims.professional_id).toBe(null);
  });

  it("assinatura inválida → throw", async () => {
    const tok = await signOAuthState(
      {
        organization_id: "o1",
        calendar_id: "c1",
        professional_id: null,
        user_id: "u1",
        nonce: "n1",
      },
      SECRET,
      600,
    );
    await expect(verifyOAuthState(tok, "wrong-secret")).rejects.toThrow();
  });

  it("expirado → throw", async () => {
    // jose `setExpirationTime` aceita instante no passado; usamos um TTL
    // negativo que o helper traduz para um exp já vencido. jwtVerify rejeita
    // (sem clockTolerance configurado neste helper) → token expirado falha.
    const tok = await signOAuthState(
      {
        organization_id: "o1",
        calendar_id: "c1",
        professional_id: null,
        user_id: "u1",
        nonce: "n1",
      },
      SECRET,
      -1,
    );
    await expect(verifyOAuthState(tok, SECRET)).rejects.toThrow();
  });

  it("alg:none (token sem assinatura) → throw", async () => {
    // Alg-confusion / downgrade: um token `alg:"none"` com claims plausíveis
    // NÃO tem assinatura. verifyOAuthState fixa `algorithms:["HS256"]`, então
    // jwtVerify deve rejeitar — trava a garantia de alg-pinning.
    const forged = new UnsecuredJWT({
      organization_id: "o1",
      calendar_id: "c1",
      professional_id: null,
      user_id: "u1",
      nonce: "n1",
    })
      .setIssuedAt()
      .setExpirationTime("600s")
      .encode();
    await expect(verifyOAuthState(forged, SECRET)).rejects.toThrow();
  });
});
