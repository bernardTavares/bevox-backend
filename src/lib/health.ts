/**
 * Health check helpers — usados por /healthz, /readyz e CLI ops.
 *
 * Convenção: cada checker retorna `{ ok, latencyMs, error? }` para que o
 * endpoint /readyz possa agregar e devolver detalhes sem expor stack traces.
 */

import { sql } from "drizzle-orm";

import { getDb } from "@/db/client.js";
import { getRedis } from "@/lib/redis.js";

export interface HealthCheckResult {
  ok: boolean;
  latencyMs: number;
  error?: string;
}

export async function timed<T>(fn: () => Promise<T>): Promise<HealthCheckResult> {
  const start = Date.now();
  try {
    await fn();
    return { ok: true, latencyMs: Date.now() - start };
  } catch (err) {
    return {
      ok: false,
      latencyMs: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function checkPostgres(): Promise<HealthCheckResult> {
  return timed(async () => {
    await getDb().execute(sql`select 1`);
  });
}

export async function checkRedis(): Promise<HealthCheckResult> {
  return timed(async () => {
    const reply = await getRedis().ping();
    if (reply !== "PONG") {
      throw new Error(`PING retornou "${reply}", esperado "PONG"`);
    }
  });
}

export interface ReadinessReport {
  ok: boolean;
  checks: {
    postgres: HealthCheckResult;
    redis: HealthCheckResult;
  };
}

export async function readiness(): Promise<ReadinessReport> {
  const [postgres, redis] = await Promise.all([checkPostgres(), checkRedis()]);
  return {
    ok: postgres.ok && redis.ok,
    checks: { postgres, redis },
  };
}
