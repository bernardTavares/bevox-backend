/**
 * Encryption at-rest de tokens OAuth (C2). AES-256-GCM, chave de 32 bytes
 * via env GOOGLE_TOKEN_ENC_KEY (base64). Layout bytea:
 *   version(1) ‖ iv(12) ‖ ciphertext(N) ‖ authTag(16)
 * O byte de versão habilita rotação multi-chave futura sem migração
 * (decrypt seleciona a chave pela versão; V1 = versão 1, chave única).
 * Genérico/reutilizável (Payments/Stripe refresh no futuro reusa).
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const VERSION = 1;
const IV_LEN = 12;
const TAG_LEN = 16;

function keyBuf(b64: string): Buffer {
  const k = Buffer.from(b64, "base64");
  if (k.length !== 32) {
    throw new Error("token-crypto key must decode to 32 bytes (base64)");
  }
  return k;
}

export function encryptToken(plaintext: string, keyB64: string): Buffer {
  const key = keyBuf(keyB64);
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([Buffer.from([VERSION]), iv, ct, tag]);
}

export function decryptToken(blob: Buffer, keyB64: string): string {
  if (blob.length < 1 + IV_LEN + TAG_LEN) throw new Error("ciphertext too short");
  const version = blob[0];
  if (version !== VERSION) throw new Error(`unsupported token-crypto version ${version}`);
  const key = keyBuf(keyB64);
  const iv = blob.subarray(1, 1 + IV_LEN);
  const tag = blob.subarray(blob.length - TAG_LEN);
  const ct = blob.subarray(1 + IV_LEN, blob.length - TAG_LEN);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}
