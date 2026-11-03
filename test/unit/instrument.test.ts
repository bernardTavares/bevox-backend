/**
 * Sentry bootstrap (`src/instrument.ts`) — no-op boot.
 *
 * instrument.ts é importado como PRIMEIRA linha de src/index.ts (antes de
 * qualquer outro módulo) e chama Sentry.init no escopo do módulo. Em dev o
 * SENTRY_DSN fica vazio → Sentry.init com dsn falsy é no-op silencioso.
 *
 * Este arquivo NÃO mocka @sentry/node: exercita o no-op REAL do SDK para
 * provar que o boot não joga sem DSN. A asserção de config (init args) vive
 * em instrument-init.test.ts (que precisa mockar o boundary).
 */

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

describe("instrument.ts — boot sem DSN", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  test("boot com SENTRY_DSN vazio NÃO joga (no-op silencioso)", async () => {
    vi.stubEnv("SENTRY_DSN", "");

    await expect(import("@/instrument.js")).resolves.toBeDefined();
  });
});
