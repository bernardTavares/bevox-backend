/**
 * Plugin Fastify — rate limiting (sliding-window via Lua atomic).
 *
 * `app.requireRateLimit({...})` devolve um preHandler que consome um
 * token-bucket sliding-window por escopo (organization > principal > IP)
 * no Redis primário via ioredis defineCommand("rateLimitSlide"):
 *   - Define headers `X-RateLimit-{Limit,Remaining,Reset,Scope}` em
 *     toda resposta.
 *   - Em violação: 429 RATE_LIMITED + `Retry-After` SOMENTE no 429
 *     (preservação do comportamento fixed-window prévio).
 *
 * Rotas opt-in (não forçado globalmente). Default = organization-scoped,
 * usando `request.organizationId` (carimbado pelo organization-scope
 * plugin) ou o principal autenticado; fallback para IP quando anônimo.
 *
 * Spec: docs/superpowers/specs/2026-05-21-backend-m5-p1-infra-scalability-design.md §6
 */

import { randomBytes } from "node:crypto";

import fp from "fastify-plugin";
import type {
  FastifyInstance,
  FastifyPluginAsync,
  FastifyReply,
  FastifyRequest,
  preHandlerHookHandler,
} from "fastify";

import { getRedis } from "@/lib/redis.js";
import { errors } from "@/shared/errors.js";
import { rateLimitDecisionsTotal, rateLimitLuaDurationSeconds } from "@/shared/metrics.js";

export interface RateLimitConfig {
  /** Máximo de requests por janela. */
  max: number;
  /** Janela em segundos. */
  windowSeconds: number;
}

export const DEFAULT_RATE_LIMIT: RateLimitConfig = { max: 600, windowSeconds: 60 };

export interface RequireRateLimitOptions {
  limit?: RateLimitConfig;
  resolveScope?: (req: FastifyRequest) => { scope: string; id: string };
}

interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: number;
  retryAfter: number;
  scope: string;
}

const RATE_LIMIT_SLIDE_LUA = `
local windowMs = tonumber(ARGV[1])
local maxN     = tonumber(ARGV[2])
local cutoff   = tonumber(ARGV[3])
local now      = tonumber(ARGV[4])
local member   = ARGV[5]
local windowSec = math.floor(windowMs / 1000)

redis.call("ZREMRANGEBYSCORE", KEYS[1], 0, "(" .. cutoff)

local count = redis.call("ZCARD", KEYS[1])

if count >= maxN then
  local oldest = redis.call("ZRANGE", KEYS[1], 0, 0, "WITHSCORES")
  local retryAfter = windowSec
  if oldest[2] then
    local oldestTs = tonumber(oldest[2])
    retryAfter = math.max(1, math.ceil((oldestTs + windowMs - now) / 1000))
  end
  redis.call("EXPIRE", KEYS[1], windowSec + 60)
  return { 0, count, retryAfter }
end

redis.call("ZADD", KEYS[1], now, member)
redis.call("EXPIRE", KEYS[1], windowSec + 60)
return { 1, count + 1, windowSec }
`;

let scriptRegistered = false;
function ensureScriptRegistered(): void {
  if (scriptRegistered) return;
  getRedis().defineCommand("rateLimitSlide", {
    numberOfKeys: 1,
    lua: RATE_LIMIT_SLIDE_LUA,
  });
  scriptRegistered = true;
}

function defaultScope(req: FastifyRequest): { scope: string; id: string } {
  if (req.organizationId) return { scope: "organization", id: req.organizationId };
  if (req.auth?.organization_id) return { scope: "organization", id: req.auth.organization_id };
  if (req.staff?.staff_id) return { scope: "staff", id: req.staff.staff_id };
  return { scope: "ip", id: req.ip };
}

async function consumeToken(
  key: string,
  scope: string,
  cfg: RateLimitConfig,
): Promise<RateLimitResult> {
  ensureScriptRegistered();
  const now = Date.now();
  const windowMs = cfg.windowSeconds * 1000;
  const cutoff = now - windowMs;
  const member = `${now}:${randomBytes(8).toString("hex")}`;

  const luaStart = process.hrtime.bigint();
  const [allowedFlag, count, retryAfter] = await getRedis().rateLimitSlide(
    `ratelimit:${scope}:${key}`,
    String(windowMs),
    String(cfg.max),
    String(cutoff),
    String(now),
    member,
  );
  const luaDurationSec = Number(process.hrtime.bigint() - luaStart) / 1e9;
  rateLimitLuaDurationSeconds.observe(luaDurationSec);
  rateLimitDecisionsTotal.inc({ scope, outcome: allowedFlag === 1 ? "allowed" : "denied" });

  return {
    allowed: allowedFlag === 1,
    limit: cfg.max,
    remaining: Math.max(0, cfg.max - count),
    resetAt: Math.floor(now / 1000) + retryAfter,
    retryAfter,
    scope,
  };
}

function applyHeaders(reply: FastifyReply, r: RateLimitResult): void {
  void reply.header("x-ratelimit-limit", String(r.limit));
  void reply.header("x-ratelimit-remaining", String(r.remaining));
  void reply.header("x-ratelimit-reset", String(r.resetAt));
  void reply.header("x-ratelimit-scope", r.scope);
}

const plugin: FastifyPluginAsync = async (app: FastifyInstance) => {
  // Register Lua script at plugin boot (idempotent via internal flag).
  ensureScriptRegistered();
  app.decorate("requireRateLimit", (opts: RequireRateLimitOptions = {}): preHandlerHookHandler => {
    const cfg = opts.limit ?? DEFAULT_RATE_LIMIT;
    const resolve = opts.resolveScope ?? defaultScope;
    return async (req, reply) => {
      const { scope, id } = resolve(req);
      const result = await consumeToken(id, scope, cfg);
      applyHeaders(reply, result);
      if (!result.allowed) {
        void reply.header("retry-after", String(Math.max(1, result.retryAfter)));
        throw errors.rateLimited(result.retryAfter, result.scope);
      }
    };
  });
};

export default fp(plugin, {
  name: "rate-limit",
  fastify: "5.x",
});

// Test-only export — kept for backward compat with any existing test.
export { consumeToken as _consumeToken };
