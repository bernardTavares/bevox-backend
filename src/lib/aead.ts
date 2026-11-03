/**
 * AEAD helper — AES-256-GCM encrypt/decrypt for secrets at rest.
 *
 * Reads `AEAD_MASTER_KEY` env (hex 32 bytes). Format of ciphertext:
 *   <iv_hex>.<authtag_hex>.<ciphertext_hex>
 *
 * Throws on missing/short key, invalid format, or auth-tag mismatch.
 * Reusable for any per-row secret (e.g. channel_subscriptions.signing_secret_ciphertext).
 *
 * Marco 4 P1 (bevox-backend/ADR-019 + ADR-012 first consumer cutover).
 */

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // bytes (96-bit, recommended for GCM)
const KEY_LENGTH = 32; // bytes (256-bit)

function getKey(): Buffer {
  const hex = process.env.AEAD_MASTER_KEY;
  if (!hex) throw new Error("AEAD_MASTER_KEY not set");
  const key = Buffer.from(hex, "hex");
  if (key.length !== KEY_LENGTH) {
    throw new Error(`AEAD_MASTER_KEY must be ${KEY_LENGTH} bytes hex (got ${key.length})`);
  }
  return key;
}

export function encrypt(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("hex")}.${tag.toString("hex")}.${ct.toString("hex")}`;
}

export function decrypt(ciphertext: string): string {
  const parts = ciphertext.split(".");
  if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) {
    throw new Error("AEAD ciphertext format invalid (expected <iv>.<tag>.<ct>)");
  }
  const ivHex = parts[0];
  const tagHex = parts[1];
  const ctHex = parts[2];
  const key = getKey();
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  const pt = Buffer.concat([decipher.update(Buffer.from(ctHex, "hex")), decipher.final()]);
  return pt.toString("utf8");
}
