/**
 * Sentry bootstrap — DEVE ser o PRIMEIRO import de src/index.ts, antes de
 * qualquer outro módulo da app.
 *
 * Sentry.init no escopo do módulo (não dentro de função) é o contrato do SDK
 * v8+: a inicialização precisa rodar antes dos imports que o SDK
 * auto-instrumenta (http, fastify, pg, ...). Por isso este arquivo lê
 * `process.env` direto — não importa `@/config/env.ts` (que tem side-effects
 * de dotenv/validação) para não inverter a ordem de boot.
 *
 * - SENTRY_DSN vazio/ausente → Sentry.init com dsn falsy é no-op silencioso
 *   (dev/test). Em prod o DSN vem do secret store SOPS via apply.
 * - sendDefaultPii=false → LGPD: coletar IP/user-agent exige base legal + DPA.
 * - tracesSampleRate=0.1 → 10% das transações (barato; ajustável).
 *
 * Init de processo restante (OpenTelemetry) + helpers (captureException,
 * Sentry.close) vivem em `@/shared/telemetry.ts`.
 */

import * as Sentry from "@sentry/node";

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV,
  sendDefaultPii: false,
  tracesSampleRate: 0.1,
});
