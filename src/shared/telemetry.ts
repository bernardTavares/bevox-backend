/**
 * OpenTelemetry + Sentry — observabilidade (PRD bevox-backend §13).
 *
 * Inicialização CONDICIONAL:
 *   - OTEL_EXPORTER_OTLP_ENDPOINT setado → SDK ativa com auto-instrumentation
 *     (fastify, pg, ioredis, undici/fetch) + exporter OTLP/HTTP.
 *
 * Sem essa env: no-op silencioso (dev/test).
 *
 * Sentry.init NÃO vive aqui — vive em `src/instrument.ts` (primeiro import de
 * src/index.ts), porque o SDK precisa inicializar antes dos módulos que
 * auto-instrumenta. Este módulo expõe apenas os helpers (captureException) e
 * o teardown Sentry (Sentry.close em shutdownTelemetry).
 *
 * IMPORTANTE: chamar `initTelemetry()` ANTES de qualquer outro import de
 * módulo da app, idealmente em src/index.ts top of file. Auto-instrumentation
 * monkey-patcha módulos via require/import hook.
 */

import * as Sentry from "@sentry/node";

import { env } from "@/config/env.js";

import { logger } from "./logger.js";

let started = false;

export async function initTelemetry(): Promise<void> {
  if (started) return;
  started = true;

  const cfg = env();

  // ---- Sentry ----
  // Sentry.init NÃO vive mais aqui: foi movido para `src/instrument.ts`
  // (importado como primeira linha de src/index.ts) para que rode antes dos
  // imports que o SDK auto-instrumenta. Este módulo só expõe os helpers
  // (captureException) e o teardown (Sentry.close em shutdownTelemetry).

  // ---- OpenTelemetry ----
  if (cfg.OTEL_EXPORTER_OTLP_ENDPOINT) {
    // Imports dinâmicos para que projetos sem OTel ativo não paguem o custo.
    const [
      { NodeSDK },
      { getNodeAutoInstrumentations },
      { OTLPTraceExporter },
      { resourceFromAttributes },
    ] = await Promise.all([
      import("@opentelemetry/sdk-node"),
      import("@opentelemetry/auto-instrumentations-node"),
      import("@opentelemetry/exporter-trace-otlp-http"),
      import("@opentelemetry/resources"),
    ]);
    const semconv = await import("@opentelemetry/semantic-conventions");

    const sdk = new NodeSDK({
      resource: resourceFromAttributes({
        [semconv.ATTR_SERVICE_NAME]: cfg.OTEL_SERVICE_NAME,
        ["service.namespace"]: "bevox",
        ["deployment.environment"]: cfg.NODE_ENV,
      }),
      traceExporter: new OTLPTraceExporter({
        url: `${cfg.OTEL_EXPORTER_OTLP_ENDPOINT}/v1/traces`,
      }),
      instrumentations: [
        getNodeAutoInstrumentations({
          // Fastify, http, pg, ioredis, undici são auto. Deixar tudo on é
          // razoável em V1; refinar quando virmos volume.
          "@opentelemetry/instrumentation-fs": { enabled: false },
        }),
      ],
    });

    sdk.start();
    logger().info(
      { endpoint: cfg.OTEL_EXPORTER_OTLP_ENDPOINT, service: cfg.OTEL_SERVICE_NAME },
      "OpenTelemetry SDK started",
    );

    // Shutdown hook é registrado pelo caller (src/index.ts) via
    // shutdownTelemetry() exportado abaixo.
    cachedSdk = sdk;
  }
}

let cachedSdk: { shutdown: () => Promise<void> } | null = null;

export async function shutdownTelemetry(): Promise<void> {
  if (cachedSdk) {
    try {
      await cachedSdk.shutdown();
    } catch {
      // best-effort
    }
    cachedSdk = null;
  }
  if (env().SENTRY_DSN) {
    await Sentry.close(2000);
  }
}

/**
 * Captura exceção via Sentry (no-op se SENTRY_DSN não configurado).
 */
export function captureException(err: unknown, context?: Record<string, unknown>): void {
  if (!env().SENTRY_DSN) return;
  Sentry.captureException(err, { extra: context });
}

/**
 * APENAS para testes — reseta o flag `started` para que initTelemetry possa
 * rodar de novo em outro test.
 */
export function __resetTelemetryForTests(): void {
  started = false;
  cachedSdk = null;
}
