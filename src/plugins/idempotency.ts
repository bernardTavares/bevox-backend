/**
 * Plugin Fastify — idempotência (ADR-015).
 *
 * Para rotas de mutação (POST/PATCH) que opt-in via
 * `app.requireIdempotency()`:
 *   1. Exige header `Idempotency-Key`.
 *   2. `GET idempotency:{key}` no Redis.
 *      - hit  → devolve o response cacheado SEM re-rodar o handler.
 *      - miss → roda o handler e então
 *               `SET idempotency:{key} {status,body} EX 86400`.
 *
 * Redis vem de `@/lib/redis.ts getRedis()`. Para testes, o plugin honra um
 * override app-level: `app.decorate('__idempotencyRedis', fakeRedis)`.
 */

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

/** Redis surface this plugin touches. */
interface IdempotencyRedis {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode: "EX", ttl: number): Promise<unknown>;
}

interface IdempotencyState {
  key: string;
  redisKey: string;
}

interface CachedResponse {
  status: number;
  body: unknown;
}

export const IDEMPOTENCY_TTL_SECONDS = 86400; // 24h (ADR-015)
const MUTATION_METHODS = new Set(["POST", "PATCH"]);
const KEY_PATTERN = /^[A-Za-z0-9._\-:/=+]{1,128}$/;

function redisFor(app: FastifyInstance): IdempotencyRedis {
  // Test seam: an injected fake Redis takes precedence over the real one.
  const override = (app as unknown as { __idempotencyRedis?: IdempotencyRedis }).__idempotencyRedis;
  if (override) return override;
  return getRedis() as unknown as IdempotencyRedis;
}

function serializeBody(payload: unknown): unknown | null {
  if (typeof payload === "string") {
    try {
      return JSON.parse(payload);
    } catch {
      return null;
    }
  }
  if (Buffer.isBuffer(payload)) return null;
  if (payload === null || payload === undefined) return null;
  if (typeof payload === "object") return payload;
  return null;
}

const plugin: FastifyPluginAsync = async (app: FastifyInstance) => {
  app.decorateRequest("idempotencyState", undefined);

  app.decorate("requireIdempotency", (): preHandlerHookHandler => {
    return async (req: FastifyRequest, reply: FastifyReply) => {
      if (!MUTATION_METHODS.has(req.method)) return;

      const headerVal = req.headers["idempotency-key"];
      const key = Array.isArray(headerVal) ? headerVal[0] : headerVal;
      if (typeof key !== "string" || !KEY_PATTERN.test(key)) {
        throw errors.invalidInput(
          "Idempotency-Key header is required (1..128 chars from [A-Za-z0-9._\\-:/=+])",
          { header: "Idempotency-Key" },
        );
      }

      const redisKey = `idempotency:${key}`;
      const redis = redisFor(app);
      const cached = await redis.get(redisKey);

      if (cached !== null) {
        let parsed: CachedResponse | null = null;
        try {
          parsed = JSON.parse(cached) as CachedResponse;
        } catch {
          parsed = null;
        }
        if (parsed) {
          // Replay — return cached response WITHOUT re-running the handler.
          void reply.status(parsed.status).header("idempotent-replay", "true").send(parsed.body);
          return reply;
        }
      }

      // Miss → run handler; capture + persist response in onSend below.
      (req as unknown as { idempotencyState?: IdempotencyState }).idempotencyState = {
        key,
        redisKey,
      };
    };
  });

  app.addHook("onSend", async (req, reply, payload) => {
    const state = (req as unknown as { idempotencyState?: IdempotencyState }).idempotencyState;
    if (!state) return payload;
    if (reply.statusCode < 200 || reply.statusCode >= 300) return payload;
    if (reply.getHeader("idempotent-replay")) return payload;

    const body = serializeBody(payload);
    if (body === null) return payload;

    const record: CachedResponse = { status: reply.statusCode, body };
    try {
      await redisFor(app).set(
        state.redisKey,
        JSON.stringify(record),
        "EX",
        IDEMPOTENCY_TTL_SECONDS,
      );
    } catch (err) {
      req.log.warn({ err, idempotency_key: state.key }, "failed to persist idempotency record");
    }
    return payload;
  });
};

export default fp(plugin, {
  name: "idempotency",
  fastify: "5.x",
});

export { KEY_PATTERN };
