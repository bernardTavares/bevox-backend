/**
 * bevox-backend — entry point.
 *
 * Bootstrap stages:
 *   0. import "./instrument.js" — PRIMEIRA linha: Sentry.init roda antes de
 *      qualquer outro módulo (contrato do SDK p/ auto-instrumentation).
 *   1. initTelemetry() — ANTES de qualquer trabalho da app (auto
 *      instrumentation OpenTelemetry monkey-patcha módulos no boot).
 *   2. Validar config (env() lança fatal se inválido)
 *   3. Construir servidor Fastify
 *   4. Registrar shutdown hooks (Fastify, queues, DB pool, Redis, telemetria)
 *   5. Listen na porta configurada (0.0.0.0:PORT)
 */

// PRIMEIRO import — Sentry.init no escopo de módulo precisa rodar antes de
// http/fastify/pg serem importados (SDK auto-instrumenta no boot).
import "./instrument.js";

import { env } from "@/config/env.js";
import { buildServer } from "@/bootstrap/server.js";
import { closeDb, initDb } from "@/db/client.js";
import { closeQueues } from "@/lib/queues.js";
import { closeRedis } from "@/lib/redis.js";
import { installShutdownHandlers, registerShutdownHook } from "@/shared/shutdown.js";
import { captureException, initTelemetry, shutdownTelemetry } from "@/shared/telemetry.js";

async function main(): Promise<void> {
  // Telemetria precisa iniciar ANTES de qualquer trabalho da app — auto
  // instrumentation OpenTelemetry monkey-patcha módulos no boot.
  await initTelemetry();

  const cfg = env();

  // Inicializa o pool + Drizzle com o schema canônico (R3: schema é
  // carregado via import() dinâmico). ANTES de servir tráfego.
  await initDb();

  const app = await buildServer();

  registerShutdownHook("fastify", () => app.close());
  registerShutdownHook("queues", () => closeQueues());
  registerShutdownHook("postgres", () => closeDb());
  registerShutdownHook("redis", () => closeRedis());
  registerShutdownHook("telemetry", () => shutdownTelemetry());

  installShutdownHandlers({ logger: (m) => app.log.info(m) });

  // Captura unhandled rejections para Sentry (no-op sem DSN).
  process.on("unhandledRejection", (reason) => {
    captureException(reason, { kind: "unhandledRejection" });
    app.log.error({ err: reason }, "unhandledRejection");
  });

  await app.listen({ port: cfg.PORT, host: "0.0.0.0" });
}

main().catch((err: unknown) => {
  captureException(err, { kind: "main_bootstrap" });
  console.error("[bevox-backend] fatal:", err);
  process.exit(1);
});
