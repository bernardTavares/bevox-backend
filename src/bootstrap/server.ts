/**
 * Factory do servidor Fastify do bevox-backend.
 *
 * Não inicia listening — apenas constrói. `main()` (em src/index.ts) chama
 * `app.listen()` e instala shutdown handlers.
 *
 * Decisões:
 *  - request.id usa UUIDv7 (ADR-001).
 *  - Logger Pino do Fastify herda LOG_LEVEL e usa o redactor 2-tier
 *    (buildRedactionConfig) — tokens sempre redacted; PII completa em INFO+.
 *  - X-Request-Id é honrado quando vem do cliente; senão geramos.
 *  - AsyncLocalStorage é setada no onRequest hook para que código fundo do
 *    call-stack possa pegar requestId via getContext().
 */

import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import sensible from "@fastify/sensible";
import * as Sentry from "@sentry/node";
import fastify, { type FastifyInstance } from "fastify";

import { env } from "@/config/env.js";
import { httpRequestDuration, httpRequestsTotal } from "@/shared/metrics.js";
import { runWithContext, type RequestContext } from "@/shared/request-context.js";
import { buildRedactionConfig } from "@/shared/redactors.js";
import { uuidv7 } from "@/shared/uuid.js";

import clerkAuth from "@/plugins/clerk-auth.js";
import errorHandlerPlugin from "@/plugins/error-handler.js";
import executionToken, {
  setExecutionTokenLookup,
  setExecutionTokenLookupAnyStatus,
} from "@/plugins/execution-token.js";
import idempotency from "@/plugins/idempotency.js";
import rateLimit from "@/plugins/rate-limit.js";
import staffAuth from "@/plugins/staff-auth.js";
import telemetry from "@/plugins/telemetry.js";
import organizationScope from "@/plugins/organization-scope.js";

import { authRoutes } from "@/modules/auth/routes.js";
import { bootstrapSubscription } from "@/modules/channels/metaapi/subscription-bootstrap.js";
import {
  findSubscriptionByUrl,
  insertSubscription,
} from "@/modules/channels/metaapi/repository.js";
import { healthRoutes } from "@/modules/health/routes.js";
import { organizationsRoutes } from "@/modules/organizations/routes.js";
import { professionalsRoutes } from "@/modules/professionals/routes.js";
import { servicesRoutes } from "@/modules/services/routes.js";
import { customersRoutes } from "@/modules/customers/routes.js";
import { channelsRoutes } from "@/modules/channels/routes.js";
import { metaapiRoutes } from "@/modules/channels/metaapi/routes.js";
import { autonomyRoutes } from "@/modules/autonomy/routes.js";
import { executionsRoutes } from "@/modules/executions/routes.js";
import { realtimeRoutes } from "@/modules/realtime/routes.js";
import { staffOpsReadRoutes } from "@/modules/staff-ops/read.routes.js";
import { staffOpsRealtimeRoutes } from "@/modules/staff-ops/realtime.routes.js";
import { staffOpsActionsRoutes } from "@/modules/staff-ops/actions.routes.js";
import { calendarRoutes } from "@/modules/calendar/routes.js";
import { waitlistRoutes } from "@/modules/calendar/waitlist/routes.js";
import { paymentsRoutes } from "@/modules/payments/routes.js";
import { stripeWebhookRoutes } from "@/modules/payments/webhook.js";
import { stripePlatformWebhookRoutes } from "@/modules/payments/webhook-platform.js";
import { googleRoutes } from "@/modules/calendar/google/routes.js";
import { googleWebhookRoutes } from "@/modules/calendar/google/webhook.js";
import { harnessCallbackRoutes } from "@/integration/harness-callbacks.routes.js";
import {
  findExecutionIdByTokenHash,
  findExecutionIdByTokenHashAnyStatus,
} from "@/integration/harness-callbacks.repository.js";

import { registerOpenApiDocs } from "@/bootstrap/openapi-docs.js";

export async function buildServer(): Promise<FastifyInstance> {
  const cfg = env();

  const app = fastify({
    logger: {
      level: cfg.LOG_LEVEL,
      redact: buildRedactionConfig(cfg.LOG_LEVEL),
      ...(cfg.NODE_ENV === "development"
        ? {
            transport: {
              target: "pino-pretty",
              options: { colorize: true, translateTime: "HH:MM:ss.l", ignore: "pid,hostname" },
            },
          }
        : {}),
    },
    // X-Request-Id do cliente é honrado; senão geramos UUIDv7.
    genReqId: (req) => {
      const incoming = req.headers["x-request-id"];
      if (typeof incoming === "string" && incoming.length > 0 && incoming.length <= 200) {
        return incoming;
      }
      return uuidv7();
    },
    requestIdLogLabel: "request_id",
    requestIdHeader: "x-request-id",
    disableRequestLogging: false,
    bodyLimit: 1_048_576,
    trustProxy: true,
  });

  // -------------------------------------------------------------------------
  // Plugins de segurança e ergonomia
  // -------------------------------------------------------------------------

  await app.register(helmet, {
    // API JSON; sem inline scripts/styles, então CSP estrita.
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'none'"],
      },
    },
    crossOriginResourcePolicy: { policy: "same-origin" },
  });

  await app.register(cors, {
    // V1: sem público externo. Default = false.
    origin: false,
  });

  await app.register(sensible);

  // -------------------------------------------------------------------------
  // Cross-cutting plugins (Task 3 — ADR-013/015).
  // Order: error-handler/telemetry/rate-limit first, then auth plugins,
  // then organization-scope + idempotency.
  // -------------------------------------------------------------------------

  await app.register(errorHandlerPlugin);
  await app.register(telemetry);
  await app.register(rateLimit);
  await app.register(clerkAuth);
  await app.register(staffAuth);
  await app.register(executionToken);
  await app.register(organizationScope);
  await app.register(idempotency);

  // Task 6: wire the execution-token plugin DB seam — token hash →
  // execution_id lookup against executions.execution_token_hash.
  setExecutionTokenLookup(findExecutionIdByTokenHash);
  setExecutionTokenLookupAnyStatus(findExecutionIdByTokenHashAnyStatus);

  // -------------------------------------------------------------------------
  // Hooks: request context (AsyncLocalStorage) + response headers
  // -------------------------------------------------------------------------

  app.addHook("onRequest", (req, _reply, done) => {
    const ctx: RequestContext = { requestId: req.id };
    (req as unknown as { __startedAt: number }).__startedAt = Date.now();
    runWithContext(ctx, () => {
      // Permite que code-paths fundos atualizem organizationId/actorId em
      // runtime. Plugins futuros (Task 3) farão patchContext().
      done();
    });
  });

  app.addHook("onResponse", (req, reply, done) => {
    const start = (req as unknown as { __startedAt?: number }).__startedAt;
    if (typeof start === "number") {
      const route = req.routeOptions?.url ?? req.url.split("?")[0] ?? req.url;
      const labels = {
        method: req.method,
        route,
        status_code: String(reply.statusCode),
      };
      httpRequestDuration.observe(labels, (Date.now() - start) / 1000);
      httpRequestsTotal.inc({ ...labels, organization_id: req.organizationId ?? "anon" });
    }
    done();
  });

  // onSend roda antes de o response sair — onResponse seria tarde demais
  // para mutar headers.
  app.addHook("onSend", (req, reply, payload, done) => {
    void reply.header("x-request-id", req.id);
    done(null, payload);
  });

  // Error handler global + 404 handler são registrados pelo
  // errorHandlerPlugin (cross-cutting plugins, acima).

  // -------------------------------------------------------------------------
  // Rotas
  // -------------------------------------------------------------------------

  await app.register(healthRoutes);

  // Task 7 — OpenAPI spec + Swagger UI em /docs (dev/staging only;
  // no-op em production). Spec canônica: openapi/bevox-backend-v1.yaml.
  await registerOpenApiDocs(app);

  // Task 5 — staff auth vertical (backend-staff-rbac, ADR-013). Registrado
  // como plugin encapsulado: o contentTypeParser raw (webhook Clerk/svix) e
  // o onResponse de auditoria de impersonation ficam scoped a este módulo.
  await app.register(authRoutes);

  // Task 6 — client CRUD modules (PRD §10.1) + harness contract (§10.4).
  await app.register(organizationsRoutes);
  await app.register(professionalsRoutes);
  await app.register(servicesRoutes);
  await app.register(customersRoutes);
  await app.register(channelsRoutes);
  // Marco 4 P1 — bevox-meta-api inbound webhook + staff health-check.
  // Plugin SCOPED: buffer content-type parser próprio (sem mudança global).
  await app.register(metaapiRoutes);
  await app.register(autonomyRoutes);
  await app.register(harnessCallbackRoutes);
  await app.register(realtimeRoutes);
  await app.register(executionsRoutes);
  await app.register(staffOpsReadRoutes);
  await app.register(staffOpsRealtimeRoutes);
  await app.register(staffOpsActionsRoutes);
  await app.register(calendarRoutes);
  await app.register(waitlistRoutes);
  // C2 Google — rotas org-scoped do cliente + webhooks públicos
  // (callback OAuth + push). Webhooks são plugins encapsulados (buffer
  // content-type parser scoped, sem mudança global).
  await app.register(googleRoutes);
  await app.register(googleWebhookRoutes);
  // Payments P1 — rotas org-scoped + connect redirects + webhook Stripe
  // (webhook é plugin encapsulado: buffer content-type parser scoped).
  await app.register(paymentsRoutes);
  await app.register(stripeWebhookRoutes);
  // Payments P2 — webhook platform-scoped (payment_intent.* e refund.* de
  // destination charge; endpoint/secret distintos do Connect P1).
  await app.register(stripePlatformWebhookRoutes);

  // Remaining §10.1 modules (calendar, channels, conversations,
  // ai-pipeline, faq, rules, autonomy, ...) land in Marco 2+.

  // -------------------------------------------------------------------------
  // Marco 4 P1 — onReady hook: bevox-meta-api subscription bootstrap.
  //
  // Cria (se ausente) a subscription push junto ao bevox-meta-api gateway
  // assim que o servidor estiver pronto. Não-fatal em falha: o backend
  // sobe e o health-check `/api/v1/health/metaapi` expõe o gap. Skip em
  // ambiente de teste (NODE_ENV=test) para não tocar gateway em unit tests.
  // -------------------------------------------------------------------------
  app.addHook("onReady", async () => {
    if (process.env.NODE_ENV === "test") return;
    const base = process.env.PUBLIC_API_BASE_URL ?? "http://localhost:3000";
    const url = `${base}/api/v1/webhooks/metaapi/events`;
    try {
      const result = await bootstrapSubscription({
        url,
        eventTypesFilter: [
          "message.received",
          "message.status_updated",
          "template.status_updated",
          "phone_number.quality_changed",
          "waba.connection_changed",
        ],
        persistSubscription: async (s) => {
          await insertSubscription({
            appId: s.appId,
            subscriptionId: s.subscriptionId,
            url: s.url,
            signingSecretPlaintext: s.signingSecretPlaintext,
          });
        },
        findExistingByUrl: async (u) => {
          const sub = await findSubscriptionByUrl(u);
          return sub ? { subscriptionId: sub.subscriptionId, status: sub.status } : null;
        },
      });
      app.log.info({ ...result }, "metaapi.subscription.bootstrap");
    } catch (err) {
      app.log.error({ err }, "metaapi.subscription.bootstrap_failed");
      // Non-fatal: backend boots; health-check surfaces the gap.
    }
  });

  // Sentry: captura erros não-tratados (default 5xx) via onError hook do SDK.
  // Registrado APÓS rotas/plugins (recomendação Sentry) e depende de
  // Sentry.init já ter rodado (src/instrument.ts, primeiro import de
  // src/index.ts). No-op sem DSN. Coexiste com errorHandlerPlugin: o SDK
  // usa addHook('onError'), não setErrorHandler — não sobrescreve a resposta.
  Sentry.setupFastifyErrorHandler(app);

  return app;
}
