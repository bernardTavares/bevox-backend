/**
 * bevox-meta-api inbound service — Stripe-style HMAC validation + ingest orchestration.
 *
 * Header format per consumer-integration-guide §3.4:
 *   X-Bevox-Signature: t=<unix>,v1=<hex_sha256>
 * Signed string: `${t}.${rawBody}`
 * Tolerance: ±300s
 *
 * Marco 4 P1.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

const TOLERANCE_SECONDS = 300;

export interface ValidationResult {
  valid: boolean;
  reason?: string;
}

export function validateBevoxSignature(input: {
  headerValue: string;
  rawBody: string;
  signingSecret: string;
}): ValidationResult {
  if (!input.headerValue) return { valid: false, reason: "header missing" };

  // Parse t=<unix>,v1=<hex>
  const parts = input.headerValue.split(",").map((p) => p.trim().split("="));
  const map = new Map<string, string>();
  for (const part of parts) {
    const k = part[0];
    const v = part[1];
    if (k && v) map.set(k, v);
  }
  const t = map.get("t");
  const v1 = map.get("v1");
  if (!t || !v1 || !/^\d+$/.test(t) || !/^[0-9a-f]+$/.test(v1)) {
    return { valid: false, reason: "format invalid (expected t=<unix>,v1=<hex>)" };
  }

  const ts = parseInt(t, 10);
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - ts) > TOLERANCE_SECONDS) {
    return { valid: false, reason: `timestamp outside ±${TOLERANCE_SECONDS}s tolerance` };
  }

  const expected = createHmac("sha256", input.signingSecret)
    .update(`${t}.${input.rawBody}`)
    .digest("hex");

  // Constant-time compare (prevent timing attacks).
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(v1, "hex");
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { valid: false, reason: "hmac mismatch" };
  }

  return { valid: true };
}

/**
 * Verification challenge handler — meta-api POSTa {verification_challenge}
 * ao URL durante subscription create. Backend deve echoar em ≤5s, NO HMAC
 * (fires antes do signing_secret existir).
 */
export function handleVerificationChallenge(input: { verification_challenge: string }): {
  challenge: string;
} {
  return { challenge: input.verification_challenge };
}
