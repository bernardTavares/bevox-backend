/**
 * Configuração tipada do bevox-backend.
 *
 * Contrato: todas as variáveis de ambiente que o serviço consome passam por
 * este schema Zod antes de serem usadas em qualquer ponto do código. Não
 * existe `process.env.X` espalhado pelo runtime — apenas `env().X`.
 *
 * Referências:
 *  - .env.example (lista canônica de variáveis)
 *  - PRD bevox-backend §11/§12/§13
 *  - ADR-013 (Clerk client-final auth + staff JWT), observabilidade
 */

import { config as loadDotenv } from "dotenv";
import { z } from "zod";

// Carrega .env primeiro, depois .env.local (override). Idempotente: se o
// arquivo não existir, dotenv silencia. NODE_ENV=test pula para evitar
// poluição em testes.
if (process.env.NODE_ENV !== "test") {
  loadDotenv({ path: ".env" });
  loadDotenv({ path: ".env.local", override: true });
}

// ---------------------------------------------------------------------------
// Sub-schemas
// ---------------------------------------------------------------------------

const NodeEnvSchema = z.enum(["development", "test", "staging", "production"]);
const LogLevelSchema = z.enum(["trace", "debug", "info", "warn", "error", "fatal"]);

// String "vazia ou ausente" → undefined; string preenchida → trim. Útil para
// permitir valores em branco em dev sem quebrar `z.url()` etc.
const optionalString = z
  .string()
  .transform((v) => v.trim())
  .transform((v) => (v.length === 0 ? undefined : v))
  .optional();

// ---------------------------------------------------------------------------
// Schema principal
// ---------------------------------------------------------------------------

const baseSchema = z.object({
  // Runtime
  NODE_ENV: NodeEnvSchema.default("development"),
  PORT: z.coerce.number().int().positive().max(65535).default(3000),
  LOG_LEVEL: LogLevelSchema.default("info"),

  // Postgres + Redis (obrigatórios em qualquer ambiente)
  DATABASE_URL: z.url(),
  REDIS_URL: z.url(),

  // Clerk — autenticação de usuários do produto (ADR-013).
  // JWKS para validar tokens Clerk; webhook secret para verificar Svix.
  CLERK_JWKS_URL: optionalString,
  CLERK_WEBHOOK_SECRET: optionalString,

  // Staff auth — autenticação de staff Bevox (HS256, painel staff — ADR-013).
  STAFF_JWT_SECRET: optionalString,
  STAFF_JWT_ACCESS_TTL: z.coerce.number().int().positive().max(86_400).default(900),
  STAFF_REFRESH_TTL_DAYS: z.coerce.number().int().positive().max(90).default(7),
  BCRYPT_COST: z.coerce.number().int().min(4).max(20).default(12),

  // Contrato backend ↔ bevox-harness (PRD §10.4). Base pública dos
  // callbacks que o harness chama de volta ({callback_base_url}).
  HARNESS_CALLBACK_BASE_URL: z.string().url().default("http://localhost:3000"),

  // Orchestration (B2). Janela de buffer (cutoff) antes do dispatch ao
  // harness e modelo LLM default quando agent_configs.default_model = NULL.
  BUFFER_CUTOFF_SECONDS: z.coerce.number().int().positive().max(600).default(45),
  AI_SUGGESTION_TTL_HOURS: z.coerce.number().int().positive().max(8760).default(24),
  DEFAULT_LLM_MODEL: z.string().min(1).default("openai/gpt-4o-mini"),

  // Google Calendar (C2 — integração calendar provider).
  GOOGLE_CLIENT_ID: optionalString,
  GOOGLE_CLIENT_SECRET: optionalString,
  GOOGLE_REDIRECT_URI: optionalString,
  GOOGLE_WEBHOOK_SECRET: optionalString,
  GOOGLE_TOKEN_ENC_KEY: optionalString,
  CALENDAR_OAUTH_SUCCESS_URL: z
    .string()
    .min(1)
    .default("http://localhost:3000/calendar/settings/google/success"),
  // Base HTTPS pública e roteável que o Google deve alcançar p/
  // webhooks/OAuth callback; domínio verificado. NÃO requiredInProd
  // (segue o precedente CALENDAR_OAUTH_SUCCESS_URL — opcional, documentado):
  // se ausente, armWatch faz fallback p/ HARNESS_CALLBACK_BASE_URL (dev).
  PUBLIC_API_BASE_URL: optionalString,

  // C3 Waitlist — tunables (não requiredInProd: defaults seguros, não
  // bloqueiam boot — precedente CALENDAR_OAUTH_SUCCESS_URL).
  WAITLIST_MATCH_DEAD_LETTER_MAX: z.coerce.number().int().positive().max(50).default(5),
  WAITLIST_MATCH_CRON: z.string().min(1).default("*/5 * * * *"),
  PACKAGE_EXPIRY_CRON: z.string().min(1).default("0 2 * * *"),

  // M5-P2a Item 5a — payment-intent reconcile cron schedule (spec §4.2).
  // Default 4×/day every 6h (intent backlog small em V1; cron picks up
  // stuck PIs that missed webhook delivery / Stripe outage). Env-tunable
  // per Risk-4 backlog-math escalation.
  PAYMENTS_RECONCILE_INTENT_CRON: z.string().min(1).default("0 */6 * * *"),

  // M5-P2a Item 5b — refund.requested reconcile cron schedule (spec §4.2).
  // Default every 2h (refund queue menor que intent + stale threshold 1h
  // → expectativa de turnaround do operador é minutos; cron 2h é defesa
  // contra webhook missed / Stripe outage). Env-tunable per Risk-4.
  PAYMENTS_RECONCILE_REFUND_CRON: z.string().min(1).default("0 */2 * * *"),

  // Payments P1 — Stripe Connect Express (canon ADR-014).
  // Credenciais core: requiredInProd (igual GOOGLE_* core). STRIPE_WEBHOOK_SECRET
  // = o whsec_ do endpoint Stripe Connect-scoped ("Connected accounts").
  STRIPE_SECRET_KEY: optionalString,
  STRIPE_WEBHOOK_SECRET: optionalString,
  STRIPE_PLATFORM_ACCOUNT_ID: optionalString,
  STRIPE_CONNECT_CLIENT_ID: optionalString,
  // Tunables (não requiredInProd: defaults seguros, precedente CALENDAR_OAUTH_SUCCESS_URL).
  PAYMENTS_RECONCILE_STALENESS_MINUTES: z.coerce.number().int().positive().max(1440).default(5),
  PAYMENTS_ONBOARDING_RETURN_URL: z
    .string()
    .min(1)
    .default("http://localhost:3000/settings/payments"),
  // Payments P2 — endpoint webhook platform-scoped (destination charge:
  // payment_intent.*/refund.* chegam no escopo PLATAFORMA, secret distinto
  // do endpoint Connect-scoped do P1; STRIPE_WEBHOOK_SECRET P1 inalterado).
  STRIPE_WEBHOOK_SECRET_PLATFORM: optionalString,
  // Tunable Pix: janela do QR. Default = default Stripe (14400s/4h);
  // range Stripe 10–1209600. Não requiredInProd (default seguro).
  PAYMENTS_PIX_EXPIRES_SECONDS: z.coerce.number().int().min(10).max(1209600).default(14400),

  // M5-P2a Item 9 — AbortSignal threading em deliverToChannel retry sleeps
  // (spec §4.6). Default false em V1 PRESERVA Marco 4 baseline behavior
  // (Risk-1 — Marco 4 baseline preservation gate). Flip true em staging
  // após M5-P2a ship → 1 week stable observation (3 critérios spec §4.6)
  // → prod flip. Quando true + signal threaded ao deliverToChannel, retry
  // sleeps são abortable (graceful shutdown vs até 7s hang per retry cycle).
  RETRY_ABORTABLE: z.coerce.boolean().default(false),

  // Test-seam feature flag. When true, the Clerk auth + organization-scope
  // plugins honor `x-test-clerk-organization` / `x-test-claim-organization`
  // request headers to inject a synthetic principal (used by integration
  // tests to exercise auth-guarded routes without a live JWKS endpoint).
  // Default false — defense-in-depth: simply running the service with
  // NODE_ENV=test (e.g. an operator mistake) is NOT sufficient to enable
  // the seam, and the production refinement below additionally REJECTS
  // any truthy value when NODE_ENV=production.
  //
  // NOTE: `z.coerce.boolean()` cannot be used here because it coerces ANY
  // non-empty string to `true` (including the literal "false"). We parse
  // the truthy aliases explicitly and mirror the same set accepted by the
  // runtime `isTestAuthBypassEnabled()` helper in the plugins.
  TEST_AUTH_BYPASS_ENABLED: z
    .string()
    .optional()
    .transform((raw) => {
      if (typeof raw !== "string") return false;
      const v = raw.trim().toLowerCase();
      return v === "true" || v === "1" || v === "yes";
    }),

  // ----- Marco 4 P1 — bevox-meta-api consumer (ADR-012 first cutover) -----
  // requiredInProd (igual STRIPE_SECRET_KEY): backend é consumer mandatório.
  META_API_BASE_URL: optionalString,
  META_API_APP_ID: optionalString,
  META_API_KEY_ID: optionalString,
  META_API_PRIVATE_KEY_PEM: optionalString,
  AEAD_MASTER_KEY: optionalString, // hex 32 bytes; src/lib/aead.ts valida length
  // M4 P2 — client timeout for POST /v1/messages outbound (12s = 10s meta-api
  // upstream Meta Graph + 2s padding for meta-api DB/serialization overhead).
  META_API_TIMEOUT_MS: optionalString, // ms; numeric string; client parseInt

  // Observabilidade — todos opcionais em dev.
  SENTRY_DSN: optionalString,
  OTEL_EXPORTER_OTLP_ENDPOINT: optionalString,
  OTEL_SERVICE_NAME: z.string().default("bevox-backend"),
});

// ---------------------------------------------------------------------------
// Refinamentos
// ---------------------------------------------------------------------------

const envSchema = baseSchema.superRefine((val, ctx) => {
  // Em produção, restrições adicionais.
  if (val.NODE_ENV === "production") {
    const requiredInProd: Array<keyof typeof val> = [
      "CLERK_JWKS_URL",
      "CLERK_WEBHOOK_SECRET",
      "STAFF_JWT_SECRET",
      "GOOGLE_CLIENT_ID",
      "GOOGLE_CLIENT_SECRET",
      "GOOGLE_REDIRECT_URI",
      "GOOGLE_WEBHOOK_SECRET",
      "GOOGLE_TOKEN_ENC_KEY",
      "STRIPE_SECRET_KEY",
      "META_API_BASE_URL",
      "META_API_APP_ID",
      "META_API_KEY_ID",
      "META_API_PRIVATE_KEY_PEM",
      "AEAD_MASTER_KEY",
      "META_API_TIMEOUT_MS",
      "STRIPE_WEBHOOK_SECRET",
      "STRIPE_PLATFORM_ACCOUNT_ID",
      "STRIPE_CONNECT_CLIENT_ID",
      "STRIPE_WEBHOOK_SECRET_PLATFORM",
    ];
    for (const key of requiredInProd) {
      if (!val[key]) {
        ctx.addIssue({
          code: "custom",
          path: [key],
          message: `${key} é obrigatório em produção`,
        });
      }
    }

    if (val.LOG_LEVEL === "debug" || val.LOG_LEVEL === "trace") {
      ctx.addIssue({
        code: "custom",
        path: ["LOG_LEVEL"],
        message: `LOG_LEVEL=${val.LOG_LEVEL} é proibido em produção (PII risk)`,
      });
    }

    // Defense-in-depth: the test-seam header bypass MUST NOT be activable
    // in production, even if someone sets the env var by mistake.
    if (val.TEST_AUTH_BYPASS_ENABLED) {
      ctx.addIssue({
        code: "custom",
        path: ["TEST_AUTH_BYPASS_ENABLED"],
        message: "TEST_AUTH_BYPASS_ENABLED=true é proibido em produção (auth bypass de teste)",
      });
    }
  }
});

// ---------------------------------------------------------------------------
// API pública
// ---------------------------------------------------------------------------

export type Env = z.infer<typeof envSchema>;

export class EnvValidationError extends Error {
  public readonly issues: Array<{ path: string; message: string }>;

  constructor(issues: Array<{ path: string; message: string }>) {
    const formatted = issues.map((i) => `  - ${i.path}: ${i.message}`).join("\n");
    super(`Configuração de ambiente inválida:\n${formatted}`);
    this.name = "EnvValidationError";
    this.issues = issues;
  }
}

/**
 * Valida e retorna a configuração. Não cacheia — útil em testes e quando
 * é preciso forçar re-leitura. Em runtime use `env()`.
 */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const issues = result.error.issues.map((i) => ({
      path: i.path.join(".") || "<root>",
      message: i.message,
    }));
    throw new EnvValidationError(issues);
  }
  return result.data;
}

let cached: Env | null = null;

/**
 * Singleton da configuração validada — leitura lazy + cache.
 * Falha fatal no primeiro acesso se o ambiente for inválido.
 */
export function env(): Env {
  if (cached === null) {
    cached = loadEnv();
  }
  return cached;
}

/**
 * Reseta o cache. Apenas para uso em testes.
 */
export function __resetEnvCacheForTests(): void {
  cached = null;
}
