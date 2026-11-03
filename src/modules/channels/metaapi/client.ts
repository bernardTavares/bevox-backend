/**
 * bevox-meta-api JWT client — RS256 ephemeral signing + HTTP wrapper.
 *
 * Per consumer-integration-guide §3.2: aud=bevox-meta-api, iss=app_id,
 * kid header from env, exp = now + 300s (≤ 5 min), scope claim
 * space-separated. Mints per-request (não pool/cache).
 *
 * 4 scopes supported per spec §2 sub-decisão 7:
 *   webhooks:write | webhooks:read | tenants:write | messages:write
 *
 * Marco 4 P1.
 */

import { SignJWT, importPKCS8 } from "jose";

export type MetaApiScope = "webhooks:write" | "webhooks:read" | "tenants:write" | "messages:write";

const VALID_SCOPES: ReadonlyArray<MetaApiScope> = [
  "webhooks:write",
  "webhooks:read",
  "tenants:write",
  "messages:write",
];

const TTL_SECONDS = 300; // 5 min — gateway max 900s, default 300s

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} not set`);
  return v;
}

export async function mintJwt(scopes: MetaApiScope[]): Promise<string> {
  if (scopes.length === 0) throw new Error("scopes must be non-empty");
  for (const s of scopes) {
    if (!VALID_SCOPES.includes(s)) {
      throw new Error(`invalid scope: ${s}`);
    }
  }

  const appId = requireEnv("META_API_APP_ID");
  const keyId = requireEnv("META_API_KEY_ID");
  const pem = requireEnv("META_API_PRIVATE_KEY_PEM");

  const privateKey = await importPKCS8(pem, "RS256");

  return await new SignJWT({ scope: scopes.join(" ") })
    .setProtectedHeader({ alg: "RS256", kid: keyId })
    .setIssuer(appId)
    .setAudience("bevox-meta-api")
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + TTL_SECONDS)
    .sign(privateKey);
}

interface FetchOpts {
  method?: "GET" | "POST" | "DELETE";
  scopes: MetaApiScope[];
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
}

/**
 * Authenticated fetch wrapper. Builds JWT + sets Authorization header.
 * Throws on non-2xx by default (callers handle specific status codes via response.ok).
 */
export async function metaApiFetch(path: string, opts: FetchOpts): Promise<Response> {
  const baseUrl = requireEnv("META_API_BASE_URL");
  const jwt = await mintJwt(opts.scopes);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), opts.timeoutMs ?? 10_000);
  try {
    return await fetch(`${baseUrl}${path}`, {
      method: opts.method ?? "GET",
      headers: {
        Authorization: `Bearer ${jwt}`,
        "Content-Type": "application/json",
        ...opts.headers,
      },
      body: opts.body,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

import type { MetaApiSendBody } from "./send-message-intent.js";

export type MetaApiErrorCode =
  | "META_UNAVAILABLE"
  | "META_REJECTED"
  | "IDEMPOTENCY_CONFLICT"
  | "RATE_LIMITED"
  | "INVALID_INPUT"
  | "INTERNAL"
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "UNKNOWN";

export type MetaApiSendResult =
  | { status: "sent"; channel: string; message_id: string; provider_message_id: string }
  | { status: "error"; code: MetaApiErrorCode; message: string };

const VALID_ERROR_CODES: ReadonlyArray<MetaApiErrorCode> = [
  "META_UNAVAILABLE",
  "META_REJECTED",
  "IDEMPOTENCY_CONFLICT",
  "RATE_LIMITED",
  "INVALID_INPUT",
  "INTERNAL",
  "UNAUTHENTICATED",
  "FORBIDDEN",
  "NOT_FOUND",
  "CONFLICT",
];

function normalizeCode(raw: unknown): MetaApiErrorCode {
  if (typeof raw === "string" && (VALID_ERROR_CODES as ReadonlyArray<string>).includes(raw)) {
    return raw as MetaApiErrorCode;
  }
  return "UNKNOWN";
}

/**
 * Send outbound message via bevox-meta-api.
 *
 * Headers: Authorization (JWT messages:write) + X-Tenant-Id + Idempotency-Key + optional X-Request-Id.
 * Timeout via env META_API_TIMEOUT_MS (default 12000ms — 10s meta-api upstream + 2s padding).
 *
 * Response handling:
 *  - HTTP 200 body.status='sent' → {status:'sent', ...}
 *  - HTTP 200 body.status='failed' → {status:'error', code: body.error.code ?? 'INTERNAL', message}
 *  - HTTP 4xx/5xx with {error:{code,message}} envelope → {status:'error', code, message}
 *  - Unparseable response or network error → {status:'error', code:'UNKNOWN', message}
 */
export async function sendMessage(input: {
  metaApiTenantId: string;
  body: MetaApiSendBody;
  idempotencyKey: string;
  requestId?: string;
}): Promise<MetaApiSendResult> {
  const timeoutMs = parseInt(process.env.META_API_TIMEOUT_MS ?? "12000", 10);

  const headers: Record<string, string> = {
    "X-Tenant-Id": input.metaApiTenantId,
    "Idempotency-Key": input.idempotencyKey,
  };
  if (input.requestId !== undefined) {
    headers["X-Request-Id"] = input.requestId;
  }

  let res: Response;
  try {
    res = await metaApiFetch("/v1/messages", {
      method: "POST",
      scopes: ["messages:write"],
      headers,
      body: JSON.stringify(input.body),
      timeoutMs,
    });
  } catch (err) {
    return {
      status: "error",
      code: "UNKNOWN",
      message: (err as Error).message ?? "network error",
    };
  }

  let parsed: unknown;
  try {
    parsed = await res.json();
  } catch {
    return {
      status: "error",
      code: "UNKNOWN",
      message: `unparseable response (HTTP ${res.status})`,
    };
  }

  // HTTP 200 path — meta-api returns SendMessageResponse with top-level status
  if (res.ok) {
    const body = parsed as {
      message_id?: string;
      provider_message_id?: string;
      channel?: string;
      status?: "sent" | "failed";
      error?: { code?: string; message?: string };
    };
    if (body.status === "sent" && body.message_id && body.provider_message_id) {
      return {
        status: "sent",
        channel: body.channel ?? input.body.channel,
        message_id: body.message_id,
        provider_message_id: body.provider_message_id,
      };
    }
    // HTTP 200 + failed envelope
    return {
      status: "error",
      code: normalizeCode(body.error?.code),
      message: body.error?.message ?? "meta-api returned failed status",
    };
  }

  // HTTP 4xx/5xx envelope {error:{code,message}}
  const errBody = parsed as { error?: { code?: string; message?: string } };
  return {
    status: "error",
    code: normalizeCode(errBody.error?.code),
    message: errBody.error?.message ?? `HTTP ${res.status}`,
  };
}
