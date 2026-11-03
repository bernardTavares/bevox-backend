import { describe, it, expect } from "vitest";

import { EnvValidationError, loadEnv } from "@/config/env.js";

/**
 * Defense-in-depth coverage for the `TEST_AUTH_BYPASS_ENABLED` feature
 * flag — finding `test-seam-auth-bypass-on-nodeenv-test`.
 *
 * The Zod env schema is the source of truth: it parses the flag in all
 * environments and REJECTS truthy values when NODE_ENV=production. The
 * plugins (clerk-auth, organization-scope) also read the flag from
 * process.env directly so the unit-test path never needs full env()
 * validation.
 */

const baseValidEnv = {
  // Required in any env: DATABASE_URL and REDIS_URL (z.url()).
  DATABASE_URL: "postgresql://u:p@h:5432/db",
  REDIS_URL: "redis://h:6379",
  // Production-required vars (we'll override NODE_ENV per case).
  CLERK_JWKS_URL: "https://example.clerk.dev/.well-known/jwks.json",
  CLERK_WEBHOOK_SECRET: "whsec_test",
  STAFF_JWT_SECRET: "x".repeat(48),
  GOOGLE_CLIENT_ID: "id",
  GOOGLE_CLIENT_SECRET: "secret",
  GOOGLE_REDIRECT_URI: "https://example.com/oauth",
  GOOGLE_WEBHOOK_SECRET: "whsec_g",
  GOOGLE_TOKEN_ENC_KEY: "x".repeat(44),
  STRIPE_SECRET_KEY: "sk_test_x",
  META_API_BASE_URL: "https://meta-api.local",
  META_API_APP_ID: "00000000-0000-7000-8000-000000000001",
  META_API_KEY_ID: "00000000-0000-7000-8000-000000000002",
  META_API_PRIVATE_KEY_PEM: "-----BEGIN PRIVATE KEY-----\nx\n-----END PRIVATE KEY-----",
  AEAD_MASTER_KEY: "a".repeat(64),
  META_API_TIMEOUT_MS: "12000",
  STRIPE_WEBHOOK_SECRET: "whsec_s",
  STRIPE_PLATFORM_ACCOUNT_ID: "acct_x",
  STRIPE_CONNECT_CLIENT_ID: "ca_x",
  STRIPE_WEBHOOK_SECRET_PLATFORM: "whsec_p",
  LOG_LEVEL: "info",
} as const;

describe("env schema — TEST_AUTH_BYPASS_ENABLED", () => {
  it("defaults to false when var is unset", () => {
    const cfg = loadEnv({
      ...baseValidEnv,
      NODE_ENV: "development",
    } as unknown as NodeJS.ProcessEnv);
    expect(cfg.TEST_AUTH_BYPASS_ENABLED).toBe(false);
  });

  it("parses 'true' as boolean true (non-production)", () => {
    const cfg = loadEnv({
      ...baseValidEnv,
      NODE_ENV: "test",
      TEST_AUTH_BYPASS_ENABLED: "true",
    } as unknown as NodeJS.ProcessEnv);
    expect(cfg.TEST_AUTH_BYPASS_ENABLED).toBe(true);
  });

  it("parses 'false' as boolean false (non-production)", () => {
    const cfg = loadEnv({
      ...baseValidEnv,
      NODE_ENV: "test",
      TEST_AUTH_BYPASS_ENABLED: "false",
    } as unknown as NodeJS.ProcessEnv);
    expect(cfg.TEST_AUTH_BYPASS_ENABLED).toBe(false);
  });

  it("REJECTS truthy value in NODE_ENV=production (defense-in-depth)", () => {
    expect(() =>
      loadEnv({
        ...baseValidEnv,
        NODE_ENV: "production",
        TEST_AUTH_BYPASS_ENABLED: "true",
      } as unknown as NodeJS.ProcessEnv),
    ).toThrow(EnvValidationError);
  });

  it("ACCEPTS falsy value in NODE_ENV=production", () => {
    const cfg = loadEnv({
      ...baseValidEnv,
      NODE_ENV: "production",
      TEST_AUTH_BYPASS_ENABLED: "false",
    } as unknown as NodeJS.ProcessEnv);
    expect(cfg.TEST_AUTH_BYPASS_ENABLED).toBe(false);
  });

  it("production refinement error path is TEST_AUTH_BYPASS_ENABLED", () => {
    try {
      loadEnv({
        ...baseValidEnv,
        NODE_ENV: "production",
        TEST_AUTH_BYPASS_ENABLED: "1",
      } as unknown as NodeJS.ProcessEnv);
      throw new Error("loadEnv should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(EnvValidationError);
      const paths = (err as EnvValidationError).issues.map((i) => i.path);
      expect(paths).toContain("TEST_AUTH_BYPASS_ENABLED");
    }
  });
});
