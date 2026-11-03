/**
 * Cache-aside helper sobre Redis primário (`@/lib/redis.js`).
 *
 * Lookup em Redis; em MISS chama `fetch` e popula com SETEX
 * JSON-serialized. Sentinel `"__NULL__"` representa lookup-with-NOT-FOUND
 * (evita DB hammer em queries a id inexistente).
 *
 * Fail-open: qualquer erro Redis (timeout/connection) loga WARN e
 * devolve o resultado de `fetch()` direto. Cache NUNCA bloqueia request.
 *
 * Caller contract: `fetch()` MUST NOT retornar a string literal
 * `"__NULL__"` como valor próprio (collision com sentinel).
 *
 * **LGPD**: log payloads em fail-open usam apenas `namespace` (não `redisKey`)
 * — keys podem conter PII (e.g., email em staff-account-by-email). Evita
 * propagação para Sentry/Loki sem base legal específica. Ver LGPD art. 46
 * (segurança proporcional) + art. 6 III (minimização) + ADR-019.
 *
 * Spec: docs/superpowers/specs/2026-05-21-backend-m5-p1-infra-scalability-design.md §4
 */

import { getRedis } from "@/lib/redis.js";
import { logger } from "@/shared/logger.js";
import { cacheInvalidationsTotal, cacheLookupsTotal } from "@/shared/metrics.js";

const NULL_SENTINEL = "__NULL__";

export interface CacheOptions {
  ttlSeconds: number;
  namespace: string;
  fetch: () => Promise<unknown>;
}

function buildKey(namespace: string, key: string): string {
  return `cache:${namespace}:${key}`;
}

export async function cacheAside(key: string, opts: CacheOptions): Promise<unknown> {
  const log = logger();
  const redisKey = buildKey(opts.namespace, key);

  let cached: string | null = null;
  try {
    cached = await getRedis().get(redisKey);
  } catch (err) {
    log.warn({ err, namespace: opts.namespace }, "cache.aside GET failed (fail-open)");
    cacheLookupsTotal.inc({ namespace: opts.namespace, outcome: "fail" });
    return opts.fetch();
  }

  if (cached === NULL_SENTINEL) {
    cacheLookupsTotal.inc({ namespace: opts.namespace, outcome: "hit" });
    return null;
  }
  if (cached !== null) {
    try {
      const parsed = JSON.parse(cached);
      cacheLookupsTotal.inc({ namespace: opts.namespace, outcome: "hit" });
      return parsed;
    } catch (err) {
      log.warn({ err, namespace: opts.namespace }, "cache.aside JSON.parse failed (refetch)");
    }
  }

  cacheLookupsTotal.inc({ namespace: opts.namespace, outcome: "miss" });
  const value = await opts.fetch();
  const payload = value === null || value === undefined ? NULL_SENTINEL : JSON.stringify(value);

  try {
    await getRedis().set(redisKey, payload, "EX", opts.ttlSeconds);
  } catch (err) {
    log.warn({ err, namespace: opts.namespace }, "cache.aside SET failed (fail-open)");
  }

  return value;
}

export async function cacheInvalidate(namespace: string, key: string): Promise<void> {
  const log = logger();
  const redisKey = buildKey(namespace, key);
  try {
    await getRedis().del(redisKey);
  } catch (err) {
    log.warn({ err, namespace }, "cache.invalidate DEL failed (fail-open)");
  }
  cacheInvalidationsTotal.inc({ namespace });
}

/** Exclusivo para testes. */
export function __resetCacheStateForTests(): void {
  // No internal state; reserved for future LRU/L1 layer.
}
