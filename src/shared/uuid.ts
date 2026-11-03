/**
 * UUIDv7 — invariante de identidade (ADR-001).
 *
 * UUIDv7 carrega timestamp Unix em ms nos primeiros 48 bits, o que dá:
 *   - ordenação temporal natural (índices b-tree eficientes)
 *   - debugging mais simples (timestamp visível no ID)
 *   - compatibilidade com qualquer storage que aceite UUID
 *
 * Uso obrigatório em IDs primários. Nada de serial/bigserial/UUIDv4.
 */

import { randomUUID } from "node:crypto";

/**
 * Gera um UUIDv7 como string (formato hifenado lowercase: 36 chars).
 *
 * Implementação manual: timestamp Unix ms (48 bits) + bits de versão/variant
 * + 74 bits aleatórios. Node 20 ainda não expõe `randomUUID({version:7})`,
 * então construímos a partir de bytes aleatórios de `randomUUID()`.
 */
export function uuidv7(): string {
  const ms = Date.now();
  const bytes = Buffer.alloc(16);

  // 48 bits de timestamp (bytes 0-5), big-endian.
  bytes.writeUIntBE(ms, 0, 6);

  // 74 bits restantes: aleatórios. Reusa entropia de um UUIDv4.
  const rnd = Buffer.from(randomUUID().replace(/-/g, ""), "hex");
  rnd.copy(bytes, 6, 6, 16);

  // Version 7 nos 4 bits altos do byte 6.
  bytes[6] = (bytes[6]! & 0x0f) | 0x70;
  // Variant RFC 4122 (10xx) nos 2 bits altos do byte 8.
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;

  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(
    16,
    20,
  )}-${hex.slice(20)}`;
}

/**
 * Extrai o timestamp em ms de um UUIDv7.
 * Útil para debug e auditoria. Não validar correctness do v7 aqui — assumimos
 * que IDs vieram de `uuidv7()`.
 */
export function uuidv7Timestamp(id: string): number {
  // Bits 0-47 (12 hex chars) = unix_ts_ms big-endian.
  const hex = id.replace(/-/g, "").slice(0, 12);
  return Number.parseInt(hex, 16);
}
