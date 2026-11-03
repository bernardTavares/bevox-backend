/**
 * AppError + códigos canônicos — PRD bevox-backend §9.4.
 *
 * Toda falha intencional do servidor lança `AppError`. O error handler
 * (src/bootstrap/error-handler.ts) converte para o JSON padronizado:
 *
 *   { "error": { "code", "message", "details?", "request_id" } }
 *
 * Nada de `throw new Error("string")` — sem `code`, fica "INTERNAL".
 */

export const ERROR_CODES = [
  "UNAUTHENTICATED",
  "FORBIDDEN",
  "INVALID_INPUT",
  "NOT_FOUND",
  "CONFLICT",
  "IDEMPOTENCY_CONFLICT",
  "RATE_LIMITED",
  "UPSTREAM_UNAVAILABLE",
  "NOT_IMPLEMENTED",
  "INTERNAL",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

const HTTP_STATUS_BY_CODE: Record<ErrorCode, number> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  INVALID_INPUT: 400,
  NOT_FOUND: 404,
  CONFLICT: 409,
  IDEMPOTENCY_CONFLICT: 409,
  RATE_LIMITED: 429,
  UPSTREAM_UNAVAILABLE: 502,
  NOT_IMPLEMENTED: 501,
  INTERNAL: 500,
};

export interface AppErrorOptions {
  code: ErrorCode;
  message: string;
  httpStatus?: number;
  details?: Record<string, unknown>;
  cause?: unknown;
  /**
   * Se `true`, error handler logará em nível `error` mesmo para 4xx.
   * Padrão: 5xx → error, 4xx → warn.
   */
  forceLogError?: boolean;
}

export class AppError extends Error {
  public readonly code: ErrorCode;
  public readonly httpStatus: number;
  public readonly details?: Record<string, unknown>;
  public readonly forceLogError: boolean;

  constructor(opts: AppErrorOptions) {
    super(opts.message, { cause: opts.cause });
    this.name = "AppError";
    this.code = opts.code;
    this.httpStatus = opts.httpStatus ?? HTTP_STATUS_BY_CODE[opts.code];
    this.details = opts.details;
    this.forceLogError = opts.forceLogError ?? false;
  }
}

// ---------------------------------------------------------------------------
// Atalhos de uso comum
// ---------------------------------------------------------------------------

export const errors = {
  unauthenticated: (message = "Authentication required", details?: Record<string, unknown>) =>
    new AppError({ code: "UNAUTHENTICATED", message, details }),

  forbidden: (message = "Permission denied", details?: Record<string, unknown>) =>
    new AppError({ code: "FORBIDDEN", message, details }),

  invalidInput: (message: string, details?: Record<string, unknown>) =>
    new AppError({ code: "INVALID_INPUT", message, details }),

  notFound: (resource: string, id?: string) =>
    new AppError({
      code: "NOT_FOUND",
      message: `${resource}${id ? ` "${id}"` : ""} not found`,
      details: id ? { resource, id } : { resource },
    }),

  conflict: (message: string, details?: Record<string, unknown>) =>
    new AppError({ code: "CONFLICT", message, details }),

  idempotencyConflict: (key: string, details?: Record<string, unknown>) =>
    new AppError({
      code: "IDEMPOTENCY_CONFLICT",
      message: `Idempotency key "${key}" reused with different payload`,
      details: { key, ...details },
    }),

  rateLimited: (retryAfterSec: number, scope: string) =>
    new AppError({
      code: "RATE_LIMITED",
      message: `Rate limit exceeded for ${scope}`,
      details: { retry_after_seconds: retryAfterSec, scope },
    }),

  upstreamUnavailable: (cause?: unknown, details?: Record<string, unknown>) =>
    new AppError({
      code: "UPSTREAM_UNAVAILABLE",
      message: "Upstream dependency unavailable",
      details,
      cause,
    }),

  /**
   * Endpoint/feature reconhecido pelo contrato (schema aceita) mas ainda não
   * implementado. Distingue NOT_IMPLEMENTED (501, futuro com plano) de
   * INVALID_INPUT (400, payload errado) e NOT_FOUND (404, rota inexistente).
   * Uso canônico V1: payment_method='checkout' (Stripe Checkout) — schema da
   * charge aceita o enum, mas a sessão ainda não é provisionada (M5-P5).
   */
  notImplemented: (feature: string, details?: Record<string, unknown>) =>
    new AppError({
      code: "NOT_IMPLEMENTED",
      message: `${feature} is not yet implemented`,
      details: { feature, ...details },
    }),

  internal: (message: string, cause?: unknown) =>
    new AppError({ code: "INTERNAL", message, cause, forceLogError: true }),
};

export function isAppError(err: unknown): err is AppError {
  return err instanceof AppError;
}
