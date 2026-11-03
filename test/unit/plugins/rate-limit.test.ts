import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// In-memory ZADD/ZCARD/ZREMRANGEBYSCORE simulator for Lua-equivalent.
const sets = new Map<string, Array<{ member: string; score: number }>>();
const mock = {
  rateLimitSlide: vi.fn(
    async (
      key: string,
      windowMsStr: string,
      maxStr: string,
      cutoffStr: string,
      nowStr: string,
      member: string,
    ): Promise<[number, number, number]> => {
      const windowMs = Number(windowMsStr);
      const max = Number(maxStr);
      const cutoff = Number(cutoffStr);
      const now = Number(nowStr);
      const windowSec = Math.floor(windowMs / 1000);

      let entries = sets.get(key) ?? [];
      // ZREMRANGEBYSCORE 0 (cutoff (exclusive)
      entries = entries.filter((e) => e.score > cutoff);

      if (entries.length >= max) {
        // DENY — don't add
        const oldest = entries[0];
        const retryAfter = oldest
          ? Math.max(1, Math.ceil((oldest.score + windowMs - now) / 1000))
          : windowSec;
        sets.set(key, entries);
        return [0, entries.length, retryAfter];
      }
      // ALLOW
      entries.push({ member, score: now });
      sets.set(key, entries);
      return [1, entries.length, windowSec];
    },
  ),
  defineCommand: vi.fn(),
};

vi.mock("@/lib/redis.js", () => ({ getRedis: () => mock }));

import { _consumeToken as consumeToken } from "@/plugins/rate-limit.js";

beforeEach(() => {
  sets.clear();
  mock.rateLimitSlide.mockClear();
});

afterEach(() => vi.restoreAllMocks());

describe("sliding-window rate-limit", () => {
  it("allows when below limit", async () => {
    const r = await consumeToken("id-1", "ip", { max: 5, windowSeconds: 60 });
    expect(r.allowed).toBe(true);
    expect(r.limit).toBe(5);
    expect(r.remaining).toBe(4);
  });

  it("denies the (max+1)th request in window", async () => {
    for (let i = 0; i < 5; i++) {
      await consumeToken("id-2", "ip", { max: 5, windowSeconds: 60 });
    }
    const r = await consumeToken("id-2", "ip", { max: 5, windowSeconds: 60 });
    expect(r.allowed).toBe(false);
    expect(r.remaining).toBe(0);
    expect(r.retryAfter).toBeGreaterThanOrEqual(1);
  });

  it("does NOT pollute the set with denied requests (no-ZADD-on-denied)", async () => {
    for (let i = 0; i < 5; i++) {
      await consumeToken("id-3", "ip", { max: 5, windowSeconds: 60 });
    }
    const denied1 = await consumeToken("id-3", "ip", { max: 5, windowSeconds: 60 });
    const denied2 = await consumeToken("id-3", "ip", { max: 5, windowSeconds: 60 });
    expect(denied1.allowed).toBe(false);
    expect(denied2.allowed).toBe(false);
    // After 2 extra denied, the underlying set still has exactly 5 entries.
    const setEntries = sets.get("ratelimit:ip:id-3") ?? [];
    expect(setEntries.length).toBe(5);
  });

  it("member uniqueness in same ms", async () => {
    // Force same ms by mocking Date.now (consumeToken should use ms-precision random suffix).
    const realNow = Date.now;
    Date.now = () => 1700000000000;
    try {
      await consumeToken("id-4", "ip", { max: 10, windowSeconds: 60 });
      await consumeToken("id-4", "ip", { max: 10, windowSeconds: 60 });
      const setEntries = sets.get("ratelimit:ip:id-4") ?? [];
      expect(setEntries.length).toBe(2);
      const [first, second] = setEntries;
      if (!first || !second) throw new Error("expected two entries");
      // both entries have the same score, but distinct members:
      expect(first.score).toBe(second.score);
      expect(first.member).not.toBe(second.member);
    } finally {
      Date.now = realNow;
    }
  });
});
