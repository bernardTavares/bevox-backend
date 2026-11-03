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

vi.mock("@/lib/redis.js", () => {
  const store = new Map<string, string>();
  const expiry = new Map<string, number>();
  const mock = {
    get: vi.fn(async (k: string) => store.get(k) ?? null),
    set: vi.fn(async (k: string, v: string, _ex: string, ttl: number) => {
      store.set(k, v);
      expiry.set(k, ttl);
      return "OK";
    }),
    del: vi.fn(async (k: string) => (store.delete(k) ? 1 : 0)),
  };
  return {
    getRedis: () => mock,
    __mockStore: store,
    __mockExpiry: expiry,
    __mockClient: mock,
  };
});

import { cacheAside, cacheInvalidate, __resetCacheStateForTests } from "@/lib/cache.js";
import * as redisMod from "@/lib/redis.js";
const mock = (redisMod as any).__mockClient as {
  get: ReturnType<typeof vi.fn>;
  set: ReturnType<typeof vi.fn>;
  del: ReturnType<typeof vi.fn>;
};
const store = (redisMod as any).__mockStore as Map<string, string>;

beforeEach(() => {
  store.clear();
  mock.get.mockClear();
  mock.set.mockClear();
  mock.del.mockClear();
  __resetCacheStateForTests();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("cacheAside", () => {
  it("MISS populates and returns fetched value", async () => {
    const fetch = vi.fn(async () => ({ id: "x" }));
    const v = await cacheAside("k1", { namespace: "test", ttlSeconds: 60, fetch });
    expect(v).toEqual({ id: "x" });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(store.get("cache:test:k1")).toBe(JSON.stringify({ id: "x" }));
  });

  it("HIT bypasses fetch and returns parsed value", async () => {
    store.set("cache:test:k2", JSON.stringify({ id: "y" }));
    const fetch = vi.fn(async () => ({ id: "BAD" }));
    const v = await cacheAside("k2", { namespace: "test", ttlSeconds: 60, fetch });
    expect(v).toEqual({ id: "y" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("null-sentinel: caches not-found with __NULL__ and returns null on HIT", async () => {
    const fetch = vi.fn(async () => null);
    const v1 = await cacheAside("k3", { namespace: "test", ttlSeconds: 60, fetch });
    expect(v1).toBeNull();
    expect(store.get("cache:test:k3")).toBe("__NULL__");
    const v2 = await cacheAside("k3", { namespace: "test", ttlSeconds: 60, fetch });
    expect(v2).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("fail-open: Redis GET throws, falls back to fetch", async () => {
    mock.get.mockRejectedValueOnce(new Error("redis down"));
    const fetch = vi.fn(async () => ({ id: "z" }));
    const v = await cacheAside("k4", { namespace: "test", ttlSeconds: 60, fetch });
    expect(v).toEqual({ id: "z" });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("fail-open: Redis SET throws, returns fetched value (no propagate)", async () => {
    mock.set.mockRejectedValueOnce(new Error("redis flap"));
    const fetch = vi.fn(async () => ({ id: "w" }));
    const v = await cacheAside("k5", { namespace: "test", ttlSeconds: 60, fetch });
    expect(v).toEqual({ id: "w" });
  });
});

describe("cacheInvalidate", () => {
  it("DELs the namespaced key", async () => {
    store.set("cache:test:k6", JSON.stringify({ id: "q" }));
    await cacheInvalidate("test", "k6");
    expect(mock.del).toHaveBeenCalledWith("cache:test:k6");
    expect(store.has("cache:test:k6")).toBe(false);
  });

  it("DEL on missing key is idempotent (no throw)", async () => {
    await expect(cacheInvalidate("test", "missing")).resolves.toBeUndefined();
  });

  it("fail-open: DEL throws, swallowed", async () => {
    mock.del.mockRejectedValueOnce(new Error("redis flap"));
    await expect(cacheInvalidate("test", "k7")).resolves.toBeUndefined();
  });
});
