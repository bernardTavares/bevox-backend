import { describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";

import { validateBevoxSignature } from "@/modules/channels/metaapi/service.js";

function signStripeStyle(secret: string, body: string, timestamp?: number): string {
  const t = timestamp ?? Math.floor(Date.now() / 1000);
  const v1 = createHmac("sha256", secret).update(`${t}.${body}`).digest("hex");
  return `t=${t},v1=${v1}`;
}

const SECRET = "test-signing-secret-123";

describe("validateBevoxSignature (Stripe-style)", () => {
  it("accepts a valid signature within tolerance", () => {
    const body = '{"event_id":"x"}';
    const sig = signStripeStyle(SECRET, body);
    const r = validateBevoxSignature({ headerValue: sig, rawBody: body, signingSecret: SECRET });
    expect(r.valid).toBe(true);
  });

  it("rejects missing header (empty string)", () => {
    const r = validateBevoxSignature({ headerValue: "", rawBody: "{}", signingSecret: SECRET });
    expect(r.valid).toBe(false);
    expect(r.reason).toMatch(/header missing/i);
  });

  it("rejects malformed header (no t= or v1=)", () => {
    const r = validateBevoxSignature({
      headerValue: "garbage",
      rawBody: "{}",
      signingSecret: SECRET,
    });
    expect(r.valid).toBe(false);
    expect(r.reason).toMatch(/format/i);
  });

  it("rejects timestamp outside tolerance (>300s old)", () => {
    const body = "{}";
    const oldTs = Math.floor(Date.now() / 1000) - 400;
    const sig = signStripeStyle(SECRET, body, oldTs);
    const r = validateBevoxSignature({ headerValue: sig, rawBody: body, signingSecret: SECRET });
    expect(r.valid).toBe(false);
    expect(r.reason).toMatch(/timestamp/i);
  });

  it("rejects timestamp in future (>300s ahead)", () => {
    const body = "{}";
    const futureTs = Math.floor(Date.now() / 1000) + 400;
    const sig = signStripeStyle(SECRET, body, futureTs);
    const r = validateBevoxSignature({ headerValue: sig, rawBody: body, signingSecret: SECRET });
    expect(r.valid).toBe(false);
    expect(r.reason).toMatch(/timestamp/i);
  });

  it("rejects HMAC mismatch (wrong secret)", () => {
    const body = "{}";
    const sig = signStripeStyle(SECRET, body);
    const r = validateBevoxSignature({
      headerValue: sig,
      rawBody: body,
      signingSecret: "different-secret",
    });
    expect(r.valid).toBe(false);
    expect(r.reason).toMatch(/hmac/i);
  });

  it("rejects HMAC mismatch (tampered body)", () => {
    const body = "{}";
    const sig = signStripeStyle(SECRET, body);
    const r = validateBevoxSignature({
      headerValue: sig,
      rawBody: '{"tampered":true}',
      signingSecret: SECRET,
    });
    expect(r.valid).toBe(false);
    expect(r.reason).toMatch(/hmac/i);
  });

  it("accepts edge-case timestamp exactly at +299s boundary", () => {
    const body = "{}";
    const ts = Math.floor(Date.now() / 1000) - 299;
    const sig = signStripeStyle(SECRET, body, ts);
    const r = validateBevoxSignature({ headerValue: sig, rawBody: body, signingSecret: SECRET });
    expect(r.valid).toBe(true);
  });
});
