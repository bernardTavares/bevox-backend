/**
 * Métricas Prometheus — PRD bevox-backend §13.3.
 *
 * Registry global + métricas-chave (HTTP, queue). Default Node metrics
 * (event loop lag, GC, heap) são coletadas automaticamente.
 *
 * Uso:
 *   import { httpRequestDuration } from '@/shared/metrics.js';
 *   httpRequestDuration.observe({...labels}, durationSec);
 */

import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from "prom-client";

export const registry = new Registry();

collectDefaultMetrics({ register: registry, prefix: "bevox_backend_" });

// ---------------------------------------------------------------------------
// HTTP server (Fastify)
// ---------------------------------------------------------------------------

export const httpRequestDuration = new Histogram({
  name: "bevox_backend_http_request_duration_seconds",
  help: "Latência de requests HTTP por método/rota/status",
  labelNames: ["method", "route", "status_code"],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [registry],
});

export const httpRequestsTotal = new Counter({
  name: "bevox_backend_http_requests_total",
  help: "Total de requests HTTP (rotuladas por method/route/status/organization)",
  labelNames: ["method", "route", "status_code", "organization_id"],
  registers: [registry],
});

// ---------------------------------------------------------------------------
// BullMQ
// ---------------------------------------------------------------------------

export const queueSize = new Gauge({
  name: "bevox_backend_queue_size",
  help: "Tamanho atual da fila (waiting + active)",
  labelNames: ["queue"],
  registers: [registry],
});

// ---------------------------------------------------------------------------
// Ingestão (B1 — PRD §10.3 / §13.3)
// ---------------------------------------------------------------------------

export const messagesReceivedTotal = new Counter({
  name: "bevox_backend_messages_received_total",
  help: "Total de mensagens/eventos inbound aceitos, rotulado por canal",
  labelNames: ["channel"],
  registers: [registry],
});

// ---------------------------------------------------------------------------
// Marco 4 P1 — bevox-meta-api inbound consumer
// ---------------------------------------------------------------------------

export const metaapiInboundEventsTotal = new Counter({
  name: "bevox_backend_metaapi_inbound_events_total",
  help: "Total de eventos recebidos do bevox-meta-api gateway por event_type/status",
  labelNames: ["event_type", "status"], // status: accepted | rejected_hmac | rejected_payload | replayed
  registers: [registry],
});

export const metaapiInboundEventDedupeHitsTotal = new Counter({
  name: "bevox_backend_metaapi_inbound_event_dedupe_hits_total",
  help: "Eventos rejeitados por dedupe Redis (event_id já processado)",
  registers: [registry],
});

export const metaapiSubscriptionStatus = new Gauge({
  name: "bevox_backend_metaapi_subscription_status",
  help: "Status da subscription bevox-meta-api (1=active, 0=disabled/missing)",
  labelNames: ["subscription_id"],
  registers: [registry],
});

// ---------------------------------------------------------------------------
// Marco 4 P2 — bevox-meta-api outbound consumer
// ---------------------------------------------------------------------------

export const metaapiOutboundMessagesTotal = new Counter({
  name: "bevox_backend_metaapi_outbound_messages_total",
  help: "Total de mensagens outbound por channel/status",
  labelNames: ["channel", "status"],
  // status ∈ sent | failed_retryable_exhausted | failed_rejected |
  //   skipped_empty_text | skipped_missing_recipient | skipped_missing_tenant
  registers: [registry],
});

export const metaapiOutboundRetriesTotal = new Counter({
  name: "bevox_backend_metaapi_outbound_retries_total",
  help: "Retries consumer-side em META_UNAVAILABLE/RATE_LIMITED/INTERNAL/UNKNOWN por channel",
  labelNames: ["channel"],
  registers: [registry],
});

export const metaapiOutboundLatencySeconds = new Histogram({
  name: "bevox_backend_metaapi_outbound_latency_seconds",
  help: "Latência de POST /v1/messages por attempt (channel/status final)",
  labelNames: ["channel", "status"],
  buckets: [0.1, 0.5, 1, 2, 5, 10],
  registers: [registry],
});

// ---------------------------------------------------------------------------
// M5-P1: cache-aside + sliding-window rate-limit observability.
// ---------------------------------------------------------------------------

export const cacheLookupsTotal = new Counter({
  name: "bevox_backend_cache_lookups_total",
  help: "cache-aside lookups por namespace + outcome",
  labelNames: ["namespace", "outcome"] as const,
  registers: [registry],
});

export const cacheInvalidationsTotal = new Counter({
  name: "bevox_backend_cache_invalidations_total",
  help: "cache-aside invalidations por namespace",
  labelNames: ["namespace"] as const,
  registers: [registry],
});

export const rateLimitDecisionsTotal = new Counter({
  name: "bevox_backend_rate_limit_decisions_total",
  help: "rate-limit decisions por scope + outcome",
  labelNames: ["scope", "outcome"] as const,
  registers: [registry],
});

export const rateLimitLuaDurationSeconds = new Histogram({
  name: "bevox_backend_rate_limit_lua_duration_seconds",
  help: "duração do Lua script de rate-limit em segundos",
  buckets: [0.0005, 0.001, 0.0025, 0.005, 0.01, 0.025, 0.05, 0.1],
  registers: [registry],
});

// ---------------------------------------------------------------------------
// M5-P2a Item 5 — payments reconcile crons (intent + refund) observability.
// ---------------------------------------------------------------------------

export const paymentsReconcileRunsTotal = new Counter({
  name: "bevox_backend_payments_reconcile_runs_total",
  help: "payment reconcile cron per-row outcomes por worker (intent|refund)",
  labelNames: ["worker", "outcome"] as const, // outcome: ok | fail
  registers: [registry],
});

export const paymentsReconcileStuckCount = new Gauge({
  name: "bevox_backend_payments_reconcile_stuck_count",
  help: "current stuck-row count picked up per reconcile worker (gauge, last tick)",
  labelNames: ["worker"] as const,
  registers: [registry],
});

export const paymentsReconcileSkippedConcurrentTotal = new Counter({
  name: "bevox_backend_payments_reconcile_skipped_concurrent_total",
  help: "reconcile cron ticks skipped because another worker holds the advisory lock",
  labelNames: ["worker"] as const,
  registers: [registry],
});

export async function renderMetrics(): Promise<{
  contentType: string;
  body: string;
}> {
  return {
    contentType: registry.contentType,
    body: await registry.metrics(),
  };
}

/**
 * APENAS para testes — limpa todos os contadores/histogramas.
 */
export function __resetMetricsForTests(): void {
  registry.resetMetrics();
}
