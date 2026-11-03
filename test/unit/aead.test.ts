/**
 * AEAD helper tests — AES-256-GCM encrypt/decrypt roundtrip + tamper detection.
 */
import { describe, expect, it, beforeAll } from "vitest";
import { randomBytes } from "node:crypto";

import { encrypt, decrypt } from "@/lib/aead.js";

const TEST_KEY = randomBytes(32).toString("hex");

beforeAll(() => {
  process.env.AEAD_MASTER_KEY = TEST_KEY;
});

describe("aead", () => {
  it("encrypts and decrypts a plaintext (roundtrip)", () => {
    const plaintext = "hello world";
    const ciphertext = encrypt(plaintext);
    expect(decrypt(ciphertext)).toBe(plaintext);
  });

  it("produces ciphertext in <iv_hex>.<authtag_hex>.<ciphertext_hex> format", () => {
    const ciphertext = encrypt("any");
    const parts = ciphertext.split(".");
    expect(parts).toHaveLength(3);
    expect(parts[0]).toMatch(/^[0-9a-f]{24}$/); // 12-byte IV
    expect(parts[1]).toMatch(/^[0-9a-f]{32}$/); // 16-byte auth tag
    expect(parts[2]).toMatch(/^[0-9a-f]+$/);
  });

  it("encrypts different IVs for the same plaintext (non-deterministic)", () => {
    const a = encrypt("same");
    const b = encrypt("same");
    expect(a).not.toBe(b);
  });

  it("decrypt fails on tampered ciphertext (auth tag invalid)", () => {
    const ciphertext = encrypt("secret");
    const parts = ciphertext.split(".");
    const iv = parts[0]!;
    const tag = parts[1]!;
    const ct = parts[2]!;
    // Flip first nibble of ct to ensure a different byte (auth tag mismatch).
    const tamperedCt = (ct[0] === "0" ? "1" : "0") + ct.slice(1);
    const tampered = `${iv}.${tag}.${tamperedCt}`;
    expect(() => decrypt(tampered)).toThrow();
  });

  it("decrypt fails on wrong key", () => {
    const ciphertext = encrypt("secret");
    process.env.AEAD_MASTER_KEY = randomBytes(32).toString("hex");
    expect(() => decrypt(ciphertext)).toThrow();
    process.env.AEAD_MASTER_KEY = TEST_KEY; // restore
  });

  it("decrypt fails on invalid format (missing parts)", () => {
    expect(() => decrypt("only-one-part")).toThrow(/format/i);
    expect(() => decrypt("only.two")).toThrow(/format/i);
  });
});
