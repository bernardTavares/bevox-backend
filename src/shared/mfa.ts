/**
 * MFA — geração e validação de segredo TOTP (ADR-013, PRD §16.3).
 *
 * Marco-1 ainda NÃO faz enforcement de TOTP no `loginStaff` (ver
 * `auth/service.ts:84` — TODO Marco-3). Mas o seed precisa parar de gravar
 * um placeholder literal no DB (achado attack `staff-mfa-sentinel`).
 *
 * Este módulo faz APENAS:
 *   - `generateMfaSecret()` → secret base32 (RFC 4648), 32 chars (160 bits),
 *     formato consumível por qualquer lib TOTP (otplib/speakeasy) quando o
 *     enforcement aterrissar em Marco-3.
 *   - `assertMfaSecretNotPlaceholder()` → falha-fechado contra um blocklist
 *     conhecido de strings inseguras. Usado pelo `seed-pilot.ts` antes de
 *     inserir o staff admin, para garantir invariante:
 *     "nenhum registro em prod nasce com placeholder de MFA".
 *
 * NÃO faz verificação TOTP de código — isso é Marco-3 e introduz dep externa
 * (otplib). Mantemos zero-dep aqui.
 */

import { randomBytes } from "node:crypto";

/**
 * Alfabeto base32 conforme RFC 4648 §6. Compatível com otplib/speakeasy
 * (encoding default) e com authenticators (Google Authenticator, Authy, 1Password).
 */
const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/**
 * Segredos historicamente usados como placeholder ou em testes. Bloqueamos
 * em `assertMfaSecretNotPlaceholder()` para que um erro de configuração não
 * vaze placeholder para prod. Lowercase para comparação case-insensitive.
 */
const BLOCKED_MFA_SECRETS: ReadonlySet<string> = new Set([
  "pilotseedonlynotasecret",
  "placeholder",
  "test",
  "testsecret",
  "changeme",
  "secret",
  "todo",
]);

/**
 * Gera um segredo MFA aleatório criptograficamente seguro em base32
 * (RFC 4648). Default 20 bytes = 160 bits de entropia (recomendação RFC 4226
 * §4 e RFC 6238 §5.1), resultando em 32 chars base32.
 *
 * O segredo retornado é consumível direto por libs TOTP (otplib.authenticator,
 * speakeasy) quando o enforcement chegar em Marco-3.
 */
export function generateMfaSecret(byteLength = 20): string {
  if (byteLength < 16) {
    throw new Error(
      `generateMfaSecret: byteLength must be >= 16 (RFC 4226 §4 recomenda 160 bits / 20 bytes).`,
    );
  }
  const buf = randomBytes(byteLength);
  return encodeBase32(buf);
}

/**
 * Asserts que o secret NÃO é um placeholder conhecido. Idempotente, sem efeitos
 * colaterais. Chamado pelo `seed-pilot.ts` antes do INSERT do staff admin —
 * garante que qualquer regressão futura (ex: alguém reintroduzir a constante
 * `PILOTSEEDONLYNOTASECRET`) trava o seed antes de tocar o DB.
 *
 * Também rejeita strings vazias / muito curtas (< 16 chars base32 = < 80 bits
 * de entropia), que não devem nunca ser usadas como MFA secret real.
 */
export function assertMfaSecretNotPlaceholder(secret: string): void {
  if (typeof secret !== "string" || secret.length === 0) {
    throw new Error("MFA secret inválido: vazio ou não-string.");
  }
  if (secret.length < 16) {
    throw new Error(
      `MFA secret inválido: comprimento ${secret.length} < 16 chars (entropia insuficiente).`,
    );
  }
  const normalized = secret.toLowerCase();
  if (BLOCKED_MFA_SECRETS.has(normalized)) {
    throw new Error(
      `MFA secret inválido: valor pertence ao blocklist de placeholders conhecidos. ` +
        `Use generateMfaSecret() ou rotacione via setup TOTP real (Marco-3).`,
    );
  }
}

/**
 * Encoder base32 minimalista (RFC 4648 §6, sem padding). Sem deps externas —
 * mantemos zero-dep no shared layer. Compatível com decoders padrão.
 */
function encodeBase32(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += BASE32_ALPHABET[(value >>> bits) & 0x1f];
    }
  }
  if (bits > 0) {
    out += BASE32_ALPHABET[(value << (5 - bits)) & 0x1f];
  }
  return out;
}
