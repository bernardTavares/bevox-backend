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

// LGPD M5-P1 fix: metadata row (cached) — id, email, full_name, role, active.
// password_hash + mfa_secret são DB-direct (não cacheados).
const staffMetadataRow = {
  id: "staff-1",
  email: "staff@bevox.io",
  full_name: "Staff One",
  role: "bevox_admin" as const,
  active: true,
};

const staffSecretsRow = {
  password_hash: "x",
  mfa_secret: "secret",
};

const dbExecute = vi.fn(async (query: unknown) => {
  // Distinguir SELECTs por inspeção do template SQL — find vs secrets.
  // drizzle SQL objects exposem `queryChunks` (não enumeráveis em String());
  // serializamos via JSON com keys.
  const chunks = (query as { queryChunks?: unknown[] })?.queryChunks ?? [];
  const text = JSON.stringify(chunks);
  if (text.includes("password_hash") || text.includes("mfa_secret")) {
    return { rows: [staffSecretsRow] };
  }
  return { rows: [staffMetadataRow] };
});

vi.mock("@/db/client.js", () => ({
  getDb: () => ({
    execute: dbExecute,
  }),
}));

import {
  findActiveStaffByEmail,
  getStaffAuthSecretsById,
  touchLastLogin,
} from "@/modules/auth/repository.js";
import * as cache from "@/lib/cache.js";

beforeEach(() => {
  cacheCalls.length = 0;
  dbExecute.mockClear();
  (cache.cacheAside as ReturnType<typeof vi.fn>).mockClear();
  (cache.cacheInvalidate as ReturnType<typeof vi.fn>).mockClear();
});

afterEach(() => vi.restoreAllMocks());

describe("staff_accounts cache wiring", () => {
  it("findActiveStaffByEmail calls cacheAside with namespace=staff-account-by-email", async () => {
    await findActiveStaffByEmail("staff@bevox.io");
    expect(cache.cacheAside).toHaveBeenCalledOnce();
    const call = (cache.cacheAside as ReturnType<typeof vi.fn>).mock.calls[0];
    if (!call) throw new Error("expected cacheAside to be called");
    expect(call[0]).toBe("staff@bevox.io");
    expect(call[1].namespace).toBe("staff-account-by-email");
    // Spec: TTL=300s; assert ≥ 60 to leave headroom for future tuning.
    expect(call[1].ttlSeconds).toBeGreaterThanOrEqual(60);
  });

  it("findActiveStaffByEmail returns metadata-only shape (NO password_hash, NO mfa_secret)", async () => {
    const row = await findActiveStaffByEmail("staff@bevox.io");
    expect(row).not.toBeNull();
    if (!row) throw new Error("expected row");
    // Shape: id, email, full_name, role, active. SECRETS NÃO devem aparecer.
    expect(row).toEqual({
      id: "staff-1",
      email: "staff@bevox.io",
      full_name: "Staff One",
      role: "bevox_admin",
      active: true,
    });
    expect((row as unknown as Record<string, unknown>).password_hash).toBeUndefined();
    expect((row as unknown as Record<string, unknown>).mfa_secret).toBeUndefined();
  });

  it("touchLastLogin does NOT call cacheInvalidate (last_login_at not in cached shape)", async () => {
    await touchLastLogin("staff-1");
    expect(cache.cacheInvalidate).not.toHaveBeenCalled();
  });

  it("getStaffAuthSecretsById fetches DB directly WITHOUT cacheAside (LGPD: secrets nunca cacheados)", async () => {
    const secrets = await getStaffAuthSecretsById("staff-1");
    expect(secrets).toEqual({ password_hash: "x", mfa_secret: "secret" });
    expect(cache.cacheAside).not.toHaveBeenCalled();
    expect(dbExecute).toHaveBeenCalledOnce();
  });
});
