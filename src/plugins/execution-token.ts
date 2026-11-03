/**
 * Plugin Fastify — validação de execution token (ADR-013).
 *
 * Os 4 callbacks do harness chegam com o header `X-Execution-Token`:
 *   - 64 caracteres hex.
 *   - SHA-256(token) é comparado contra `executions.execution_token_hash`.
 *
 * A lookup em DB fica atrás de uma seam fina (`executionTokenLookup`) que
 * a Task 4/6 conecta — a lógica de formato + hash é real e testável aqui.
 *
 * Decora `request.executionContext = { execution_id }`.
 * Expõe `app.requireExecutionToken()` (preHandler).
 */

import { createHash } from "node:crypto";

import fp from "fastify-plugin";
import type { FastifyInstance, FastifyPluginAsync, preHandlerHookHandler } from "fastify";

import { errors } from "@/shared/errors.js";

const TOKEN_PATTERN = /^[0-9a-f]{64}$/;

/** SHA-256 hex do execution token. Só o hash é comparado. */
export function hashExecutionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Valida o formato canônico do token (64 chars hex lowercase). */
export function isValidExecutionTokenFormat(token: string): boolean {
  return TOKEN_PATTERN.test(token);
}

/**
 * Seam de lookup. Task 4/6: wire executions.execution_token_hash lookup.
 * Recebe o hash SHA-256 do token e devolve o execution_id, ou null se
 * nenhuma execução ativa casar. Default no-op até a Task 4 criar a tabela
 * `executions` e a Task 6 injetar o repositório real via
 * `setExecutionTokenLookup()`.
 */
export type ExecutionTokenLookup = (tokenHash: string) => Promise<string | null>;

// Task 4/6: wire executions.execution_token_hash lookup
let lookupImpl: ExecutionTokenLookup = async () => null;

export function setExecutionTokenLookup(fn: ExecutionTokenLookup): void {
  lookupImpl = fn;
}

// Status-agnostic lookup seam — used ONLY by the dead_letter signal path
// (dispatch-contract amendment 2026-06-03). The authoritative dead_letter
// transition (ADR-019 Amendment 1) must resolve terminal executions (e.g.
// `error`) that the default, status-filtered lookup excludes.
let lookupAnyStatusImpl: ExecutionTokenLookup = async () => null;

export function setExecutionTokenLookupAnyStatus(fn: ExecutionTokenLookup): void {
  lookupAnyStatusImpl = fn;
}

async function resolveWith(
  token: string,
  lookup: ExecutionTokenLookup,
): Promise<{ execution_id: string }> {
  if (!isValidExecutionTokenFormat(token)) {
    throw errors.unauthenticated("X-Execution-Token must be 64 hex characters");
  }
  const executionId = await lookup(hashExecutionToken(token));
  if (executionId === null) {
    throw errors.unauthenticated("Unknown or revoked execution token");
  }
  return { execution_id: executionId };
}

/** Default resolution (excludes terminal executions) — the 3 non-dead_letter callbacks. */
export async function resolveExecutionToken(token: string): Promise<{ execution_id: string }> {
  return resolveWith(token, lookupImpl);
}

/** Status-agnostic resolution — ONLY the dead_letter signal path. */
export async function resolveExecutionTokenAnyStatus(
  token: string,
): Promise<{ execution_id: string }> {
  return resolveWith(token, lookupAnyStatusImpl);
}

/**
 * A token resolves to exactly one execution. The callback route's `:id`
 * must be that execution, otherwise a token minted for execution A could
 * act on execution B (IDOR). Fails with 403 before any handler/DB work.
 */
export function assertTokenBoundToRoute(params: unknown, ctx: { execution_id: string }): void {
  const routeId = (params as { id?: unknown } | undefined)?.id;
  if (typeof routeId === "string" && routeId !== ctx.execution_id) {
    throw errors.forbidden("Execution token does not belong to this execution");
  }
}

const plugin: FastifyPluginAsync = async (app: FastifyInstance) => {
  app.decorateRequest("executionContext", undefined);

  app.decorate("requireExecutionToken", (): preHandlerHookHandler => {
    return async (req) => {
      const headerVal = req.headers["x-execution-token"];
      const token = Array.isArray(headerVal) ? headerVal[0] : headerVal;
      if (typeof token !== "string" || token.length === 0) {
        throw errors.unauthenticated("Missing X-Execution-Token header");
      }
      const ctx = await resolveExecutionToken(token);
      assertTokenBoundToRoute(req.params, ctx);
      req.executionContext = ctx;
    };
  });
};

export default fp(plugin, {
  name: "execution-token",
  fastify: "5.x",
});
