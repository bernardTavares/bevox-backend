/**
 * Subscription bootstrap — startup task.
 *
 * Reads local channel_subscriptions by URL; if present, no-op (trust local
 * state). Otherwise POST /v1/webhooks/subscriptions com stable
 * Idempotency-Key per environment (24h cache em meta-api).
 *
 * meta-api faz URL verification challenge ANTES de ativar — backend route
 * (em routes.ts) responde {verification_challenge} echo, NO HMAC, ≤5s.
 *
 * Marco 4 P1.
 */

import { metaApiFetch, type MetaApiScope } from "./client.js";

interface FetchFn {
  (
    path: string,
    opts: {
      method?: "GET" | "POST" | "DELETE";
      headers?: Record<string, string>;
      body?: string;
      scopes?: MetaApiScope[];
    },
  ): Promise<Response>;
}

let fetchForTests: FetchFn | null = null;

export function setMetaApiFetchForTests(fn: FetchFn): void {
  fetchForTests = fn;
}

export function resetMetaApiFetchForTests(): void {
  fetchForTests = null;
}

function doFetch(path: string, opts: Parameters<FetchFn>[1]): Promise<Response> {
  if (fetchForTests) return fetchForTests(path, opts);
  return metaApiFetch(path, {
    method: opts.method ?? "GET",
    scopes: opts.scopes ?? ["webhooks:read"],
    headers: opts.headers,
    body: opts.body,
  });
}

interface BootstrapInput {
  url: string;
  eventTypesFilter: string[];
  persistSubscription: (input: {
    subscriptionId: string;
    signingSecretPlaintext: string;
    appId: string;
    url: string;
  }) => Promise<void>;
  findExistingByUrl: (
    url: string,
  ) => Promise<{ subscriptionId: string; status: "active" | "paused" | "disabled" } | null>;
}

export interface BootstrapResult {
  created: boolean;
  subscriptionId: string;
}

export async function bootstrapSubscription(input: BootstrapInput): Promise<BootstrapResult> {
  const existing = await input.findExistingByUrl(input.url);
  if (existing) {
    return { created: false, subscriptionId: existing.subscriptionId };
  }

  const idempotencyKey = `sub-${process.env.NODE_ENV ?? "production"}-bootstrap`;
  const body = JSON.stringify({
    delivery_mode: "push",
    url: input.url,
    event_types_filter: input.eventTypesFilter,
  });

  const res = await doFetch("/v1/webhooks/subscriptions", {
    method: "POST",
    scopes: ["webhooks:write"],
    headers: { "Idempotency-Key": idempotencyKey },
    body,
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`meta-api subscription create failed: ${res.status} ${errText}`);
  }

  const sub = (await res.json()) as {
    id: string;
    app_id: string;
    url: string;
    signing_secret: string;
  };

  await input.persistSubscription({
    subscriptionId: sub.id,
    signingSecretPlaintext: sub.signing_secret,
    appId: sub.app_id,
    url: sub.url,
  });

  return { created: true, subscriptionId: sub.id };
}
