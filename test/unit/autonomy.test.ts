import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * resolveExecutionMode precedência (Modelo §10.5 / ADR-018):
 *   channel ai_mode_override > org autonomy_profiles.current_mode >
 *   default manual_assisted.
 *
 * resolver.ts importa getDb / findChannelConnectionById como bindings de
 * módulo (sem seam de injeção, ao contrário do idempotency plugin que
 * expõe `app.decorate("__idempotencyRedis")`). Como resolver.ts NÃO pode
 * ser alterado para virar testável, o único mecanismo viável para
 * substituir esses bindings é o module-level vi.mock — extensão do uso de
 * `vi`/`vi.fn` já presente em test/unit/plugins/idempotency.test.ts.
 */

vi.mock("@/modules/channels/repository.js", () => ({
  findChannelConnectionById: vi.fn(),
}));
vi.mock("@/db/client.js", () => ({
  getDb: vi.fn(),
}));

import { getDb } from "@/db/client.js";
import { findChannelConnectionById } from "@/modules/channels/repository.js";

import { resolveExecutionMode } from "@/modules/autonomy/resolver.js";

const mockFind = vi.mocked(findChannelConnectionById);
const mockGetDb = vi.mocked(getDb);

function dbReturning(rows: unknown[]) {
  mockGetDb.mockReturnValue({
    execute: vi.fn().mockResolvedValue({ rows }),
  } as unknown as ReturnType<typeof getDb>);
}

describe("resolveExecutionMode precedence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("channel ai_mode_override wins over org current_mode", async () => {
    mockFind.mockResolvedValue({
      id: "c1",
      organization_id: "o1",
      provider: "chatwoot",
      external_account_id: "x",
      status: "connected",
      routing_config_json: { ai_mode_override: "autonomous_supervised" },
    });
    dbReturning([{ current_mode: "manual_assisted" }]);
    expect(await resolveExecutionMode({ organizationId: "o1", channelConnectionId: "c1" })).toBe(
      "autonomous_supervised",
    );
  });

  it("falls back to org current_mode when channel has no override", async () => {
    mockFind.mockResolvedValue({
      id: "c1",
      organization_id: "o1",
      provider: "chatwoot",
      external_account_id: "x",
      status: "connected",
      routing_config_json: {},
    });
    dbReturning([{ current_mode: "copilot" }]);
    expect(await resolveExecutionMode({ organizationId: "o1", channelConnectionId: "c1" })).toBe(
      "copilot",
    );
  });

  it("falls back to org current_mode when channel connection is not found", async () => {
    mockFind.mockResolvedValue(null);
    dbReturning([{ current_mode: "copilot" }]);
    expect(
      await resolveExecutionMode({ organizationId: "o1", channelConnectionId: "missing" }),
    ).toBe("copilot");
  });

  it("defaults to manual_assisted when no profile row", async () => {
    dbReturning([]);
    expect(await resolveExecutionMode({ organizationId: "o1" })).toBe("manual_assisted");
  });
});
