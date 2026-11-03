/**
 * C2 Google — single-flight por-conexão via Redis (NX EX + release fenced).
 *
 * Dois gatilhos disparam incremental p/ a MESMA conexão (job de webhook +
 * cron de safety). Sem serialização → `runIncrementalSync` concorrente cria
 * appointments `external_sync` DUPLICADOS e estoura a unique-violation de
 * `appointment_google_events`. Idem para refresh de token concorrente
 * (T6 race). Este helper serializa por chave; se o lock não é adquirido o
 * caller decide (skip ou re-read).
 *
 * Lock: Redis `SET key <token> NX EX ttlSec` onde `<token>` é único por
 * aquisição (`randomUUID`). Release é VALUE-CHECKED (fenced): só apaga a
 * chave se ela AINDA contém o token DESTA aquisição (compare-and-del atômico
 * via Lua). Logo um detentor cujo TTL expirou NUNCA rouba/apaga o lock de um
 * sucessor — o `get` no Lua não bate com o token antigo e nada é apagado.
 *
 * Resíduo limitado consciente (decisão documentada, NÃO silenciosa): se
 * `fn()` excede o TTL (incremental de calendário grande / full-resync pós-410
 * pode passar dos 120s), a chave auto-expira e uma SEGUNDA execução pode
 * sobrepor a primeira pelo restante — inerente a qualquer lock por TTL.
 * Aceitável em V1 porque o blast-radius é contido por:
 *  (a) enqueue de incremental usa `jobId=connectionId`, colapsando duplicatas
 *      in-flight na fila; e
 *  (b) `applyExternalEvent` é idempotente por `(connection, google_event_id)`
 *      via `findMappingByEvent` (não recria appointment já mapeado).
 * O release fenced elimina o roubo de lock; só a sobreposição-por-overrun,
 * intrínseca a TTL locks, permanece — e está coberta por (a)+(b).
 */
import { randomUUID } from "node:crypto";

import { getRedis } from "@/lib/redis.js";

/**
 * Adquire `key` (Redis `SET <token> NX EX ttlSec`, token único por
 * aquisição). Se adquirido roda `fn` e libera no finally via
 * compare-and-del atômico (Lua: só apaga se o valor ainda é o NOSSO token);
 * se NÃO adquirido retorna `null` (outra execução cobre) e NÃO tenta
 * release (não pode deletar lock alheio). Comportamento p/ callers
 * inalterado: retorna `T` (adquirido) ou `null` (ocupado).
 */
export async function withRedisLock<T>(
  key: string,
  ttlSec: number,
  fn: () => Promise<T>,
): Promise<T | null> {
  const token = randomUUID();
  const acquired = await getRedis().set(key, token, "EX", ttlSec, "NX");
  if (acquired !== "OK") return null;
  try {
    return await fn();
  } finally {
    // Release fenced: apaga a chave APENAS se ela ainda contém o token
    // desta aquisição. Se o TTL expirou e um sucessor já assumiu (token
    // diferente), o `get` não bate → del NÃO ocorre → lock do sucessor
    // permanece intacto. Atômico (Lua eval) → sem janela get/del.
    await getRedis().eval(
      "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
      1,
      key,
      token,
    );
  }
}

/** Lock por-conexão p/ incremental sync (skip-se-ocupado, TTL 120s). */
export async function withConnectionLock<T>(
  connectionId: string,
  fn: () => Promise<T>,
): Promise<T | null> {
  return withRedisLock(`google:sync:lock:${connectionId}`, 120, fn);
}
