/**
 * Unit tests para `src/shared/mfa.ts` (achado attack `staff-mfa-sentinel`).
 *
 * Cobre o foundation Marco-1: geração de secret base32 real e validador
 * blocklist que impede placeholders entrarem em `staff_accounts.mfa_secret`.
 *
 * TOTP enforcement = Marco-3 (PRD §16.3 / ADR-013), fora deste PR.
 */

import { describe, expect, it } from "vitest";

import { assertMfaSecretNotPlaceholder, generateMfaSecret } from "@/shared/mfa.js";

describe("generateMfaSecret", () => {
  it("retorna string base32 (RFC 4648) — só A-Z2-7", () => {
    const secret = generateMfaSecret();
    expect(secret).toMatch(/^[A-Z2-7]+$/);
  });

  it("default = 32 chars (160 bits, RFC 4226 §4)", () => {
    const secret = generateMfaSecret();
    expect(secret.length).toBe(32);
  });

  it("byteLength customizado produz length proporcional", () => {
    // 32 bytes * 8 bits / 5 bits per char = 51.2 → 52 chars (com padding implícito)
    const secret = generateMfaSecret(32);
    expect(secret.length).toBeGreaterThanOrEqual(51);
  });

  it("rejeita byteLength < 16 (entropia insuficiente)", () => {
    expect(() => generateMfaSecret(8)).toThrow(/byteLength must be >= 16/);
  });

  it("produz secrets distintos em chamadas sucessivas (entropia real)", () => {
    const secrets = new Set<string>();
    for (let i = 0; i < 32; i++) {
      secrets.add(generateMfaSecret());
    }
    // Probabilidade de colisão entre 32 amostras de 160 bits é ~0 — qualquer
    // colisão indica gerador determinístico ou bug grave.
    expect(secrets.size).toBe(32);
  });

  it("passa pelo próprio validador (sanity loop fechado)", () => {
    for (let i = 0; i < 8; i++) {
      expect(() => assertMfaSecretNotPlaceholder(generateMfaSecret())).not.toThrow();
    }
  });
});

describe("assertMfaSecretNotPlaceholder", () => {
  it("rejeita o sentinel histórico (case-insensitive)", () => {
    expect(() => assertMfaSecretNotPlaceholder("PILOTSEEDONLYNOTASECRET")).toThrow(
      /blocklist|placeholder/i,
    );
    expect(() => assertMfaSecretNotPlaceholder("pilotseedonlynotasecret")).toThrow(
      /blocklist|placeholder/i,
    );
    expect(() => assertMfaSecretNotPlaceholder("PilotSeedOnlyNotASecret")).toThrow(
      /blocklist|placeholder/i,
    );
  });

  it("rejeita placeholders comuns (placeholder, test, changeme, secret, todo)", () => {
    for (const bad of ["placeholder", "test", "TEST", "changeme", "secret", "todo", "testsecret"]) {
      expect(() => assertMfaSecretNotPlaceholder(bad)).toThrow(/blocklist|placeholder|< 16/i);
    }
  });

  it("rejeita string vazia", () => {
    expect(() => assertMfaSecretNotPlaceholder("")).toThrow(/vazio/i);
  });

  it("rejeita string curta (< 16 chars = < 80 bits)", () => {
    expect(() => assertMfaSecretNotPlaceholder("ABC")).toThrow(/< 16/);
    expect(() => assertMfaSecretNotPlaceholder("ABCDEFGHIJKLMNO")).toThrow(/< 16/);
  });

  it("aceita secret base32 válido de 32 chars", () => {
    // Secret base32 fixo válido — 32 chars, alfabeto correto.
    expect(() => assertMfaSecretNotPlaceholder("JBSWY3DPEHPK3PXP6XZGNZS2WLBJWPMI")).not.toThrow();
  });

  it("aceita secret real gerado pelo próprio módulo", () => {
    const secret = generateMfaSecret();
    expect(() => assertMfaSecretNotPlaceholder(secret)).not.toThrow();
  });
});
