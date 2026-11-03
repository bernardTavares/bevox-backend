/**
 * Clerk JWT verification tests — exercises the REAL `verifyClerkJwt`
 * (`src/plugins/clerk-auth.ts`) end-to-end against a mocked JWKS that is
 * keyed to a local RSA key pair. Without these tests the production
 * verification path was never exercised — only the `NODE_ENV=test` seam.
 *
 * Coverage:
 *   - Happy path (valid RS256, all claims present) → returns auth fields.
 *   - Forged token (signed with a DIFFERENT RSA key) → rejected.
 *   - Algorithm confusion (HS256 token offered to RS256 verifier) → rejected.
 *   - `alg: none` (unsigned token) → rejected.
 *   - Missing `organization_id` claim → rejected.
 *   - Missing `clerk_user_id` AND `sub` claim → rejected.
 *   - Expired token (`exp` in the past) → rejected.
 *   - Not-yet-valid token (`nbf` in the future, beyond clockTolerance) → rejected.
 *   - Tampered signature → rejected.
 *
 * Follow-up (NOT in this PR):
 *   - Integration test against a real Clerk dev tenant (issuer-bound JWKS).
 *   - Periodic RSA key rotation drill (JWKS cache invalidation).
 */
import { describe, expect, it, beforeAll, vi } from "vitest";
import { generateKeyPairSync, randomBytes } from "node:crypto";
import type * as joseTypes from "jose";

// Generate one trusted key pair (the "real" issuer key) and one untrusted
// pair (the "attacker" key used to forge tokens). Both are RS256/2048.
const trusted = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});

const attacker = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});

// HMAC secret used to forge an HS256 token (algorithm confusion attempt).
const HS256_SECRET = randomBytes(32);

// Mock the `jose` module: pass through everything except
// `createRemoteJWKSet`, which we substitute with a local function that
// returns the TRUSTED public key for any header. This is the cleanest way
// to test the verifier without booting a real JWKS HTTP endpoint, while
// keeping `jwtVerify` (the security-critical path) untouched.
vi.mock("jose", async () => {
  const actual = await vi.importActual<typeof joseTypes>("jose");
  return {
    ...actual,
    createRemoteJWKSet: () => {
      // GetKeyFunction signature: (header, input) → KeyLike | Uint8Array.
      // We hand back the trusted SPKI imported as an RS256 key.
      return async () => actual.importSPKI(trusted.publicKey, "RS256");
    },
  };
});

beforeAll(() => {
  // Required so `getJwks()` doesn't bail on missing CLERK_JWKS_URL.
  // Value is arbitrary — `createRemoteJWKSet` is mocked.
  process.env.CLERK_JWKS_URL = "https://example.clerk.test/.well-known/jwks.json";
  // verifyClerkJwt reads DATABASE_URL/REDIS_URL via env(); seed both so
  // the zod parse in env() succeeds. Real fixtures would come from .env.
  process.env.DATABASE_URL ??= "postgres://test:test@localhost:5432/test";
  process.env.REDIS_URL ??= "redis://localhost:6379";
});

// Lazy import after mock is registered.
async function importVerifier() {
  const mod = await import("@/plugins/clerk-auth.js");
  return mod.verifyClerkJwt;
}

// Helper: sign a JWT with the given private key, alg, and payload.
async function signRS256(
  payload: Record<string, unknown>,
  opts: { privateKeyPem?: string; alg?: string } = {},
): Promise<string> {
  const { SignJWT, importPKCS8 } = await import("jose");
  const alg = opts.alg ?? "RS256";
  const pem = opts.privateKeyPem ?? trusted.privateKey;
  const key = await importPKCS8(pem, alg);
  return await new SignJWT(payload).setProtectedHeader({ alg, typ: "JWT" }).sign(key);
}

// Build a base64url-encoded JSON segment (header/payload).
function b64url(obj: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(obj)).toString("base64url");
}

describe("verifyClerkJwt — real RS256 verification path", () => {
  it("accepts a valid token signed with the trusted key and returns claims", async () => {
    const verify = await importVerifier();
    const now = Math.floor(Date.now() / 1000);
    const token = await signRS256({
      sub: "user_abc",
      organization_id: "org_xyz",
      role: "admin",
      iat: now,
      exp: now + 300,
    });
    const auth = await verify(token);
    expect(auth).toEqual({
      clerk_user_id: "user_abc",
      organization_id: "org_xyz",
      role: "admin",
    });
  });

  it("defaults role to 'member' when claim is absent", async () => {
    const verify = await importVerifier();
    const now = Math.floor(Date.now() / 1000);
    const token = await signRS256({
      sub: "user_no_role",
      organization_id: "org_xyz",
      iat: now,
      exp: now + 300,
    });
    const auth = await verify(token);
    expect(auth.role).toBe("member");
  });

  it("prefers explicit clerk_user_id over sub when both are present", async () => {
    const verify = await importVerifier();
    const now = Math.floor(Date.now() / 1000);
    const token = await signRS256({
      sub: "fallback_sub",
      clerk_user_id: "user_explicit",
      organization_id: "org_xyz",
      iat: now,
      exp: now + 300,
    });
    const auth = await verify(token);
    expect(auth.clerk_user_id).toBe("user_explicit");
  });

  it("rejects a forged token signed with an untrusted RSA key", async () => {
    const verify = await importVerifier();
    const now = Math.floor(Date.now() / 1000);
    const forged = await signRS256(
      { sub: "user_attacker", organization_id: "org_pwned", iat: now, exp: now + 300 },
      { privateKeyPem: attacker.privateKey },
    );
    await expect(verify(forged)).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
    });
  });

  it("rejects an HS256 token (algorithm confusion attack)", async () => {
    const verify = await importVerifier();
    const { SignJWT } = await import("jose");
    const now = Math.floor(Date.now() / 1000);
    const hsToken = await new SignJWT({
      sub: "user_attacker",
      organization_id: "org_xyz",
      iat: now,
      exp: now + 300,
    })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .sign(HS256_SECRET);
    await expect(verify(hsToken)).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
    });
  });

  it("rejects an unsigned token (alg: none)", async () => {
    const verify = await importVerifier();
    const now = Math.floor(Date.now() / 1000);
    // jose refuses to mint `alg: none` tokens — craft manually.
    const header = b64url({ alg: "none", typ: "JWT" });
    const payload = b64url({
      sub: "user_attacker",
      organization_id: "org_xyz",
      iat: now,
      exp: now + 300,
    });
    const noneToken = `${header}.${payload}.`;
    await expect(verify(noneToken)).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
    });
  });

  it("rejects a valid signature missing the organization_id claim", async () => {
    const verify = await importVerifier();
    const now = Math.floor(Date.now() / 1000);
    const token = await signRS256({
      sub: "user_abc",
      role: "admin",
      iat: now,
      exp: now + 300,
    });
    await expect(verify(token)).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
      message: expect.stringMatching(/organization_id/i),
    });
  });

  it("rejects a token with an empty-string organization_id", async () => {
    const verify = await importVerifier();
    const now = Math.floor(Date.now() / 1000);
    const token = await signRS256({
      sub: "user_abc",
      organization_id: "",
      iat: now,
      exp: now + 300,
    });
    await expect(verify(token)).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
      message: expect.stringMatching(/organization_id/i),
    });
  });

  it("rejects a valid signature missing BOTH clerk_user_id and sub", async () => {
    const verify = await importVerifier();
    const now = Math.floor(Date.now() / 1000);
    const token = await signRS256({
      organization_id: "org_xyz",
      role: "admin",
      iat: now,
      exp: now + 300,
    });
    await expect(verify(token)).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
      message: expect.stringMatching(/clerk_user_id/i),
    });
  });

  it("rejects an expired token (exp in the past, beyond clockTolerance)", async () => {
    const verify = await importVerifier();
    const now = Math.floor(Date.now() / 1000);
    const token = await signRS256({
      sub: "user_abc",
      organization_id: "org_xyz",
      iat: now - 3600,
      exp: now - 60, // expired 60s ago; tolerance is 5s
    });
    await expect(verify(token)).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
    });
  });

  it("rejects a not-yet-valid token (nbf in the future, beyond clockTolerance)", async () => {
    const verify = await importVerifier();
    const now = Math.floor(Date.now() / 1000);
    const token = await signRS256({
      sub: "user_abc",
      organization_id: "org_xyz",
      iat: now,
      nbf: now + 600, // valid only in 10 min; tolerance is 5s
      exp: now + 1800,
    });
    await expect(verify(token)).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
    });
  });

  it("rejects a token whose signature segment has been tampered with", async () => {
    const verify = await importVerifier();
    const now = Math.floor(Date.now() / 1000);
    const good = await signRS256({
      sub: "user_abc",
      organization_id: "org_xyz",
      iat: now,
      exp: now + 300,
    });
    const parts = good.split(".");
    expect(parts).toHaveLength(3);
    const sig = parts[2]!;
    // Flip first character of the signature to invalidate it.
    const flipped = (sig[0] === "A" ? "B" : "A") + sig.slice(1);
    const tampered = `${parts[0]}.${parts[1]}.${flipped}`;
    await expect(verify(tampered)).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
    });
  });

  it("rejects a structurally malformed token", async () => {
    const verify = await importVerifier();
    await expect(verify("not.a.jwt")).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
    });
    await expect(verify("only-one-segment")).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
    });
  });
});
