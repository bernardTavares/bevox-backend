/**
 * Sentry bootstrap (`src/instrument.ts`) — config LGPD-safe.
 *
 * Mocka @sentry/node (boundary de terceiro) para asserir que instrument.ts
 * chama Sentry.init com os defaults travados:
 *   - sendDefaultPii=false  → LGPD: coletar IP/user-agent exige base legal.
 *   - tracesSampleRate=0.1  → 10% (barato; ajustável).
 *   - dsn vindo de process.env.SENTRY_DSN (nunca hardcoded).
 */

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import type * as SentryNode from "@sentry/node";

vi.mock("@sentry/node", async (importActual) => {
  const actual = await importActual<typeof SentryNode>();
  return { ...actual, init: vi.fn(() => undefined) };
});

describe("instrument.ts — Sentry.init config", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  test("chama Sentry.init com dsn do env, sendDefaultPii=false e tracesSampleRate=0.1", async () => {
    const dsn = "https://examplePublicKey@o0.ingest.sentry.io/0";
    vi.stubEnv("SENTRY_DSN", dsn);

    const Sentry = await import("@sentry/node");
    await import("@/instrument.js");

    expect(Sentry.init).toHaveBeenCalledTimes(1);
    expect(Sentry.init).toHaveBeenCalledWith(
      expect.objectContaining({
        dsn,
        sendDefaultPii: false,
        tracesSampleRate: 0.1,
      }),
    );
  });
});
