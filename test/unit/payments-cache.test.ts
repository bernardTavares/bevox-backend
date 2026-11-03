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

const dbRow = {
  id: "pa-1",
  organization_id: "org-1",
  account_holder_type: "organization",
  external_account_id: null,
  onboarding_status: "pending",
  charges_enabled: false,
  payouts_enabled: false,
  details_submitted: false,
};

// Sequenciador de respostas db: o getOrCreateLocalAccount test precisa
// forçar a branch INSERT (existing=null → INSERT → re-SELECT row). Demais
// testes recebem row em qualquer SELECT.
const dbResponses: Array<{ rows: unknown[] }> = [];

vi.mock("@/db/client.js", () => ({
  getDb: () => ({
    execute: vi.fn(async () => {
      if (dbResponses.length > 0) {
        return dbResponses.shift() as { rows: unknown[] };
      }
      return { rows: [dbRow] };
    }),
  }),
}));

import {
  getByOrg,
  getOrCreateLocalAccount,
  setExternalAccountId,
  updateOnboardingState,
} from "@/modules/payments/repository.js";
import * as cache from "@/lib/cache.js";

beforeEach(() => {
  cacheCalls.length = 0;
  dbResponses.length = 0;
  (cache.cacheAside as ReturnType<typeof vi.fn>).mockClear();
  (cache.cacheInvalidate as ReturnType<typeof vi.fn>).mockClear();
});

afterEach(() => vi.restoreAllMocks());

describe("payment_accounts cache wiring", () => {
  it("getByOrg calls cacheAside with namespace=payment-account-by-org", async () => {
    await getByOrg("org-1");
    expect(cache.cacheAside).toHaveBeenCalledOnce();
    const call = (cache.cacheAside as ReturnType<typeof vi.fn>).mock.calls[0];
    if (!call) throw new Error("expected cacheAside to be called");
    expect(call[0]).toBe("org-1");
    expect(call[1].namespace).toBe("payment-account-by-org");
    expect(call[1].ttlSeconds).toBeGreaterThanOrEqual(30);
  });

  it("getOrCreateLocalAccount invokes cacheInvalidate(payment-account-by-org, orgId)", async () => {
    // Forçar a INSERT branch: 1ª getByOrg() → null; INSERT → ok; 2ª getByOrg() → row.
    dbResponses.push({ rows: [] }); // getByOrg pré-insert
    dbResponses.push({ rows: [] }); // INSERT
    dbResponses.push({ rows: [dbRow] }); // re-SELECT pós-invalidate
    await getOrCreateLocalAccount("org-1");
    expect(cache.cacheInvalidate).toHaveBeenCalledWith("payment-account-by-org", "org-1");
  });

  it("setExternalAccountId invokes cacheInvalidate(payment-account-by-org, orgId)", async () => {
    await setExternalAccountId("org-1", "pa-1", "acct_X");
    expect(cache.cacheInvalidate).toHaveBeenCalledWith("payment-account-by-org", "org-1");
  });

  it("updateOnboardingState invokes cacheInvalidate(payment-account-by-org, orgId)", async () => {
    await updateOnboardingState("org-1", "pa-1", {
      onboarding_status: "complete",
      charges_enabled: true,
      payouts_enabled: true,
      details_submitted: true,
    });
    expect(cache.cacheInvalidate).toHaveBeenCalledWith("payment-account-by-org", "org-1");
  });
});
