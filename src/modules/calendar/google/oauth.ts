/**
 * C2 Google OAuth. State = JWT HS256 (STAFF_JWT_SECRET, via `jose` — mesmo
 * idioma de src/plugins/staff-auth.ts) + nonce Redis single-use (anti-replay,
 * em vez de um HMAC-blob stateless). Scope calendar.events (canon).
 * Tokens encriptados AES-256-GCM (src/lib/token-crypto.ts).
 */
import { SignJWT, jwtVerify } from "jose";

import { env } from "@/config/env.js";
import { decryptToken, encryptToken } from "@/lib/token-crypto.js";
import { getRedis } from "@/lib/redis.js";
import { errors } from "@/shared/errors.js";
import { uuidv7 } from "@/shared/uuid.js";

import {
  GOOGLE_OAUTH_AUTH_URL,
  GOOGLE_OAUTH_NONCE_TTL_SECONDS,
  GOOGLE_OAUTH_REVOKE_URL,
  GOOGLE_OAUTH_SCOPE,
  GOOGLE_OAUTH_TOKEN_URL,
  GOOGLE_USERINFO_URL,
} from "./constants.js";
import * as repo from "./repository.js";

export interface OAuthStateClaims {
  organization_id: string;
  calendar_id: string;
  professional_id: string | null;
  user_id: string;
  nonce: string;
}

const OAUTH_STATE_AUDIENCE = "bevox-google-oauth-state";

function secretKey(secret: string): Uint8Array {
  return new TextEncoder().encode(secret);
}

/**
 * Assina o state OAuth como JWT HS256. ASYNC (idioma `jose`, igual a
 * staff-auth.ts: setProtectedHeader + setIssuedAt + setExpirationTime).
 * `ttlSec` negativo/zero produz um `exp` já vencido (usado em testes) —
 * `setExpirationTime("-1s")` é um instante no passado e jwtVerify rejeita.
 */
export async function signOAuthState(
  c: OAuthStateClaims,
  secret: string,
  ttlSec: number,
): Promise<string> {
  return new SignJWT({ ...c })
    .setProtectedHeader({ alg: "HS256" })
    .setAudience(OAUTH_STATE_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${ttlSec}s`)
    .sign(secretKey(secret));
}

/** Verifica + decodifica o state JWT. ASYNC (jose). Lança se inválido/expirado. */
export async function verifyOAuthState(token: string, secret: string): Promise<OAuthStateClaims> {
  const { payload } = await jwtVerify(token, secretKey(secret), {
    algorithms: ["HS256"],
    audience: OAUTH_STATE_AUDIENCE,
  });
  return {
    organization_id: payload.organization_id as string,
    calendar_id: payload.calendar_id as string,
    // Normaliza missing OR empty-string → null: conexões org-level têm
    // professional_id null, e o branch ON CONFLICT de repo.upsertConnection
    // depende de null (não ""). `?? null` sozinho NÃO coalesce "".
    professional_id:
      typeof payload.professional_id === "string" && payload.professional_id.length > 0
        ? payload.professional_id
        : null,
    user_id: payload.user_id as string,
    nonce: payload.nonce as string,
  };
}

interface GoogleOAuthConfig {
  secret: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  tokenEncKey: string;
  successUrl: string;
}

/**
 * Lê + narrows o env. STAFF_JWT_SECRET e GOOGLE_* são `optionalString`
 * (`string | undefined`); este guard estreita-os a `string` e devolve um
 * config tipado, evitando `!` espalhado pelo módulo (narrowed-config approach).
 */
function cfg(): GoogleOAuthConfig {
  const e = env();
  if (!e.STAFF_JWT_SECRET) {
    throw errors.internal("STAFF_JWT_SECRET not configured");
  }
  if (
    !e.GOOGLE_CLIENT_ID ||
    !e.GOOGLE_CLIENT_SECRET ||
    !e.GOOGLE_REDIRECT_URI ||
    !e.GOOGLE_TOKEN_ENC_KEY
  ) {
    throw errors.internal("Google OAuth env not configured");
  }
  return {
    secret: e.STAFF_JWT_SECRET,
    clientId: e.GOOGLE_CLIENT_ID,
    clientSecret: e.GOOGLE_CLIENT_SECRET,
    redirectUri: e.GOOGLE_REDIRECT_URI,
    tokenEncKey: e.GOOGLE_TOKEN_ENC_KEY,
    // CALENDAR_OAUTH_SUCCESS_URL tem default localhost e NÃO é
    // requiredInProd (env.ts): em produção o operador DEVE setá-lo ou o
    // callback redireciona silenciosamente para localhost. Follow-on
    // documentado (T1 carry-forward) — não corrigido aqui.
    successUrl: e.CALENDAR_OAUTH_SUCCESS_URL,
  };
}

export async function buildAuthorizeUrl(input: {
  organizationId: string;
  calendarId: string;
  professionalId: string | null;
  userId: string;
}): Promise<string> {
  const c = cfg();
  const nonce = uuidv7();
  await getRedis().set(`google:oauth:nonce:${nonce}`, "1", "EX", GOOGLE_OAUTH_NONCE_TTL_SECONDS);
  const state = await signOAuthState(
    {
      organization_id: input.organizationId,
      calendar_id: input.calendarId,
      professional_id: input.professionalId,
      user_id: input.userId,
      nonce,
    },
    c.secret,
    GOOGLE_OAUTH_NONCE_TTL_SECONDS,
  );
  const u = new URL(GOOGLE_OAUTH_AUTH_URL);
  u.searchParams.set("client_id", c.clientId);
  u.searchParams.set("redirect_uri", c.redirectUri);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", GOOGLE_OAUTH_SCOPE);
  u.searchParams.set("access_type", "offline");
  u.searchParams.set("prompt", "consent");
  u.searchParams.set("include_granted_scopes", "true");
  u.searchParams.set("state", state);
  return u.toString();
}

export async function handleCallback(
  code: string,
  state: string,
): Promise<{ connectionId: string; successUrl: string }> {
  const c = cfg();
  let claims: OAuthStateClaims;
  try {
    claims = await verifyOAuthState(state, c.secret);
  } catch {
    throw errors.invalidInput("invalid oauth state");
  }
  // Nonce single-use: getdel é atômico (ioredis). Se ausente/já consumido →
  // replay ou expiração; rejeita (anti-replay, corrige o HMAC stateless).
  const consumed = await getRedis().getdel(`google:oauth:nonce:${claims.nonce}`);
  if (consumed !== "1") {
    throw errors.invalidInput("oauth state replay or expired");
  }

  const tokenRes = await fetch(GOOGLE_OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: c.clientId,
      client_secret: c.clientSecret,
      redirect_uri: c.redirectUri,
      grant_type: "authorization_code",
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!tokenRes.ok) {
    throw errors.invalidInput(`google token exchange failed: ${tokenRes.status}`);
  }
  const tok = (await tokenRes.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
  };

  const uiRes = await fetch(GOOGLE_USERINFO_URL, {
    headers: { Authorization: `Bearer ${tok.access_token}` },
    signal: AbortSignal.timeout(10_000),
  });
  const email = uiRes.ok ? (((await uiRes.json()) as { email?: string }).email ?? "") : "";

  const connectionId = await repo.upsertConnection({
    organizationId: claims.organization_id,
    calendarId: claims.calendar_id,
    // claims.professional_id é `string | null` (verifyOAuthState normaliza
    // missing OR empty-string → null): NUNCA "" — o branch de
    // ON CONFLICT em upsertConnection depende dessa truthiness.
    professionalId: claims.professional_id,
    googleAccountEmail: email,
    externalCalendarId: "primary",
    refreshTokenEncrypted: tok.refresh_token
      ? encryptToken(tok.refresh_token, c.tokenEncKey)
      : null,
    accessTokenEncrypted: encryptToken(tok.access_token, c.tokenEncKey),
    accessTokenExpiresAt: new Date(Date.now() + tok.expires_in * 1000),
  });
  return { connectionId, successUrl: c.successUrl };
}

export async function revokeConnection(connectionId: string): Promise<void> {
  const conn = await repo.findConnectionById(connectionId);
  if (!conn) {
    throw errors.notFound("CalendarProviderConnection", connectionId);
  }
  const c = cfg();
  if (conn.google_access_token_encrypted) {
    try {
      // Deliberadamente best-effort: decryptToken LANÇA em tamper ou
      // key-mismatch (chave rotacionada/antiga). Um token indecifrável NÃO
      // pode bloquear o revoke local — capturamos e seguimos para limpar
      // o estado local de qualquer forma (T1 carry-forward).
      const at = decryptToken(conn.google_access_token_encrypted, c.tokenEncKey);
      await fetch(GOOGLE_OAUTH_REVOKE_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token: at }),
        signal: AbortSignal.timeout(10_000),
      }).catch(() => undefined);
    } catch {
      /* token indecifrável (key rotacionada) — ainda limpa localmente */
    }
  }
  await repo.clearWatchAndTokens(connectionId);
}
