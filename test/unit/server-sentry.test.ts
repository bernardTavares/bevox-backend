/**
 * Sentry ↔ Fastify wiring — buildServer() deve chamar
 * Sentry.setupFastifyErrorHandler(app) durante o bootstrap, para que erros
 * não-tratados (5xx) sejam capturados pelo handler oficial do SDK.
 *
 * Redis é mockado: getRedis() conecta eager (lazyConnect:false) ao registrar
 * o plugin rate-limit; sem mock o buildServer tentaria abrir conexão real.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

// Mocka o boundary @sentry/node: ESM não deixa vi.spyOn um export nativo.
// Mock MANUAL (não importActual) — importar o SDK real ativaria a
// auto-instrumentation OTel do Fastify, que patcha o módulo e quebra
// buildServer no unit test. Só precisamos dos exports que o boot referencia.
vi.mock("@sentry/node", () => ({
  setupFastifyErrorHandler: vi.fn(() => undefined),
  init: vi.fn(() => undefined),
  captureException: vi.fn(() => undefined),
  close: vi.fn(async () => true),
}));

// rate-limit chama getRedis().defineCommand no register — stub para não
// abrir conexão Redis real em unit test.
vi.mock("@/lib/redis.js", () => ({
  getRedis: () => ({ defineCommand: () => undefined }),
  createBullMQConnection: () => ({}),
  closeRedis: async () => undefined,
  __resetRedisStateForTests: () => undefined,
}));

import * as Sentry from "@sentry/node";

import { buildServer } from "@/bootstrap/server.js";
import { __resetEnvCacheForTests } from "@/config/env.js";

describe("buildServer — Sentry Fastify error handler", () => {
  beforeEach(() => {
    __resetEnvCacheForTests();
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("DATABASE_URL", "postgres://u:p@localhost:5432/bevox_test");
    vi.stubEnv("REDIS_URL", "redis://localhost:6379");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    __resetEnvCacheForTests();
  });

  test("setupFastifyErrorHandler é chamado com a instância do app", async () => {
    const spy = vi.mocked(Sentry.setupFastifyErrorHandler);

    const app = await buildServer();
    try {
      expect(spy).toHaveBeenCalledTimes(1);
      // Identidade por referência (toBe) — NÃO toHaveBeenCalledWith(app): a
      // comparação deep do matcher percorre getters do Fastify (listeningOrigin)
      // que jogam quando o server não está em listen.
      expect(spy.mock.calls[0]?.[0]).toBe(app);
    } finally {
      await app.close();
    }
  });
});
