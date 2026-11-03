/**
 * Plugin Fastify de telemetria — sem double-capture no Sentry.
 *
 * A captura de erros não-tratados (5xx) é dona do
 * Sentry.setupFastifyErrorHandler (wired em buildServer). O plugin NÃO deve
 * chamar captureException no seu próprio onError, senão cada 5xx vira 2
 * eventos no Sentry. O plugin mantém só a propagação de contexto (preHandler).
 */

import fastify from "fastify";
import { afterEach, describe, expect, test, vi } from "vitest";

const captureExceptionMock = vi.fn();
vi.mock("@/shared/telemetry.js", () => ({
  captureException: (...args: unknown[]) => captureExceptionMock(...args),
}));

import telemetryPlugin from "@/plugins/telemetry.js";

describe("telemetry plugin", () => {
  afterEach(() => {
    captureExceptionMock.mockReset();
  });

  test("erro não-tratado NÃO é capturado pelo plugin (setupFastifyErrorHandler é dono)", async () => {
    const app = fastify();
    await app.register(telemetryPlugin);
    app.get("/boom", async () => {
      throw new Error("kaboom");
    });
    await app.ready();

    try {
      const res = await app.inject({ method: "GET", url: "/boom" });
      expect(res.statusCode).toBe(500);
      expect(captureExceptionMock).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });
});
