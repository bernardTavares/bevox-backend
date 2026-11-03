/**
 * Logger Pino centralizado — PRD bevox-backend §13.
 *
 * Regras (não-negociáveis):
 *  - PII redaction obrigatória via `buildRedactionConfig()` (2-tier:
 *    ALWAYS tokens/secrets em DEBUG; lista PII completa em INFO+).
 *  - Nunca logar: tokens, secrets, password_hash, conteúdo externo de egress.
 *  - Sempre logar: request_id, organization_id, actor_id quando disponíveis.
 *
 * Em runtime via Fastify, prefira `req.log.info(...)` — o request logger
 * já vem com bindings do request_id. Use este logger raiz apenas em
 * bootstrap, workers e CLI.
 */

import { pino, type Logger as PinoLogger, type LoggerOptions } from "pino";

import { env } from "@/config/env.js";

import { buildRedactionConfig } from "./redactors.js";
import { getContext } from "./request-context.js";

function buildLoggerOptions(): LoggerOptions {
  const cfg = env();
  return {
    level: cfg.LOG_LEVEL,
    redact: buildRedactionConfig(cfg.LOG_LEVEL),
    base: {
      service: cfg.OTEL_SERVICE_NAME,
      env: cfg.NODE_ENV,
    },
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
      level: (label) => ({ level: label }),
    },
    // Em dev: pretty-print. Em outros ambientes: JSON estruturado.
    ...(cfg.NODE_ENV === "development"
      ? {
          transport: {
            target: "pino-pretty",
            options: {
              colorize: true,
              translateTime: "HH:MM:ss.l",
              ignore: "pid,hostname",
            },
          },
        }
      : {}),
  };
}

let rootLogger: PinoLogger | null = null;

/**
 * Logger raiz do processo. Cacheado e lazy — só lê env na primeira chamada.
 */
export function logger(): PinoLogger {
  if (rootLogger === null) rootLogger = pino(buildLoggerOptions());
  return rootLogger;
}

/**
 * Logger com bindings do RequestContext atual (request_id, organization_id,
 * actor_id). Usar em código fora do path Fastify (workers, helpers).
 */
export function contextLogger(): PinoLogger {
  const ctx = getContext();
  if (!ctx) return logger();
  return logger().child({
    request_id: ctx.requestId,
    organization_id: ctx.organizationId,
    actor_id: ctx.actorId,
  });
}

export function __resetLoggerForTests(): void {
  rootLogger = null;
}
