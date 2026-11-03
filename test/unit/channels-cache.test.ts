import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/shared/logger.js", () => {
  const noop = vi.fn();
  const logInstance = {
    warn: noop,
    info: noop,
    debug: noop,
    error: noop,
    trace: noop,
    fatal: noop,
    child: () => logInstance,
  };
  return {
    logger: () => logInstance,
    contextLogger: () => logInstance,
    __resetLoggerForTests: vi.fn(),
  };
});

const cacheCalls: Array<{ fn: string; args: unknown[] }> = [];
vi.mock("@/lib/cache.js", () => ({
  cacheAside: vi.fn(async (_key, opts: { fetch: () => Promise<unknown> }) => {
    cacheCalls.push({ fn: "cacheAside", args: [_key] });
    return opts.fetch();
  }),
  cacheInvalidate: vi.fn(async (ns: string, key: string) => {
    cacheCalls.push({ fn: "cacheInvalidate", args: [ns, key] });
  }),
}));

const ccRow = {
  id: "cc-1",
  organization_id: "org-1",
  provider: "meta",
  external_account_id: "wa-1",
  status: "active",
  routing_config_json: {},
};

// Sequenciador: upsert test precisa devolver { id: "cc-mock-1" } no INSERT
// RETURNING. Demais testes recebem ccRow.
const dbResponses: Array<{ rows: unknown[] }> = [];

vi.mock("@/db/client.js", () => ({
  getDb: () => ({
    execute: vi.fn(async () => {
      if (dbResponses.length > 0) {
        return dbResponses.shift() as { rows: unknown[] };
      }
      return { rows: [ccRow] };
    }),
  }),
}));

import {
  findChannelConnectionById,
  upsertChannelConnection,
} from "@/modules/channels/repository.js";
import * as cache from "@/lib/cache.js";

beforeEach(() => {
  cacheCalls.length = 0;
  dbResponses.length = 0;
  (cache.cacheAside as ReturnType<typeof vi.fn>).mockClear();
  (cache.cacheInvalidate as ReturnType<typeof vi.fn>).mockClear();
});

afterEach(() => vi.restoreAllMocks());

describe("channel_connections cache wiring", () => {
  it("findChannelConnectionById calls cacheAside with namespace=channel-connection", async () => {
    await findChannelConnectionById("cc-1");
    expect(cache.cacheAside).toHaveBeenCalledOnce();
    const call = (cache.cacheAside as ReturnType<typeof vi.fn>).mock.calls[0];
    if (!call) throw new Error("expected cacheAside to be called");
    expect(call[0]).toBe("cc-1");
    expect(call[1].namespace).toBe("channel-connection");
    expect(call[1].ttlSeconds).toBeGreaterThanOrEqual(30);
  });

  it("upsertChannelConnection invokes cacheInvalidate(channel-connection, returnedId)", async () => {
    dbResponses.push({ rows: [{ id: "cc-mock-1" }] }); // INSERT...RETURNING
    const returnedId = await upsertChannelConnection({
      organizationId: "org-1",
      provider: "meta",
      externalAccountId: "wa-1",
    });
    expect(returnedId).toBe("cc-mock-1");
    expect(cache.cacheInvalidate).toHaveBeenCalledWith("channel-connection", "cc-mock-1");
  });
});
