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

vi.mock("@/db/client.js", () => ({
  getDb: () => ({
    execute: vi.fn(async () => ({ rows: [{ id: "org-1", name: "Acme" }] })),
  }),
}));

import {
  advanceOnboarding,
  getOrganization,
  updateOrganization,
} from "@/modules/organizations/repository.js";
import * as cache from "@/lib/cache.js";

beforeEach(() => {
  cacheCalls.length = 0;
  (cache.cacheAside as ReturnType<typeof vi.fn>).mockClear();
  (cache.cacheInvalidate as ReturnType<typeof vi.fn>).mockClear();
});

afterEach(() => vi.restoreAllMocks());

describe("organizations cache wiring", () => {
  it("getOrganization calls cacheAside with namespace=org", async () => {
    await getOrganization("org-1");
    expect(cache.cacheAside).toHaveBeenCalledOnce();
    const call = (cache.cacheAside as ReturnType<typeof vi.fn>).mock.calls[0];
    if (!call) throw new Error("expected cacheAside to be called");
    expect(call[0]).toBe("org-1");
    expect(call[1].namespace).toBe("org");
    expect(call[1].ttlSeconds).toBeGreaterThanOrEqual(30);
  });

  it("updateOrganization invokes cacheInvalidate(org, id)", async () => {
    await updateOrganization("org-1", { name: "New" });
    expect(cache.cacheInvalidate).toHaveBeenCalledWith("org", "org-1");
  });

  it("advanceOnboarding invokes cacheInvalidate(org, orgId)", async () => {
    await advanceOnboarding("org-1", "channels-connected");
    expect(cache.cacheInvalidate).toHaveBeenCalledWith("org", "org-1");
  });
});
