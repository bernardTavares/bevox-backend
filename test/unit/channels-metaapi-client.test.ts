import { describe, expect, it, beforeAll } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import { jwtVerify, importSPKI } from "jose";

import { mintJwt, type MetaApiScope } from "@/modules/channels/metaapi/client.js";

const { publicKey, privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});

beforeAll(() => {
  process.env.META_API_APP_ID = "0193e45a-c5e4-7000-9000-000000000001";
  process.env.META_API_KEY_ID = "0193e45a-c5e4-7000-9000-000000000002";
  process.env.META_API_PRIVATE_KEY_PEM = privateKey;
});

describe("mintJwt", () => {
  it("mints valid RS256 JWT with correct iss/aud/kid/scope", async () => {
    const jwt = await mintJwt(["webhooks:write"]);
    const spki = await importSPKI(publicKey, "RS256");
    const { payload, protectedHeader } = await jwtVerify(jwt, spki, {
      audience: "bevox-meta-api",
      issuer: process.env.META_API_APP_ID,
    });
    expect(protectedHeader.kid).toBe(process.env.META_API_KEY_ID);
    expect(protectedHeader.alg).toBe("RS256");
    expect(payload.scope).toBe("webhooks:write");
  });

  it("joins multiple scopes space-separated", async () => {
    const jwt = await mintJwt(["webhooks:write", "webhooks:read"]);
    const spki = await importSPKI(publicKey, "RS256");
    const { payload } = await jwtVerify(jwt, spki, {
      audience: "bevox-meta-api",
      issuer: process.env.META_API_APP_ID,
    });
    expect(payload.scope).toBe("webhooks:write webhooks:read");
  });

  it("supports all 4 P1 scopes", async () => {
    const scopes: MetaApiScope[] = [
      "webhooks:write",
      "webhooks:read",
      "tenants:write",
      "messages:write",
    ];
    for (const scope of scopes) {
      const jwt = await mintJwt([scope]);
      expect(jwt.split(".")).toHaveLength(3);
    }
  });

  it("sets exp ≤ 5 min from iat", async () => {
    const jwt = await mintJwt(["webhooks:read"]);
    const spki = await importSPKI(publicKey, "RS256");
    const { payload } = await jwtVerify(jwt, spki, {
      audience: "bevox-meta-api",
      issuer: process.env.META_API_APP_ID,
    });
    expect((payload.exp ?? 0) - (payload.iat ?? 0)).toBeLessThanOrEqual(300);
  });

  it("throws if META_API_APP_ID missing", async () => {
    const saved = process.env.META_API_APP_ID;
    delete process.env.META_API_APP_ID;
    await expect(mintJwt(["webhooks:read"])).rejects.toThrow(/META_API_APP_ID/);
    process.env.META_API_APP_ID = saved;
  });

  it("throws if META_API_PRIVATE_KEY_PEM missing", async () => {
    const saved = process.env.META_API_PRIVATE_KEY_PEM;
    delete process.env.META_API_PRIVATE_KEY_PEM;
    await expect(mintJwt(["webhooks:read"])).rejects.toThrow(/META_API_PRIVATE_KEY_PEM/);
    process.env.META_API_PRIVATE_KEY_PEM = saved;
  });

  it("throws on empty scopes array", async () => {
    await expect(mintJwt([])).rejects.toThrow(/scopes/i);
  });

  it("throws on invalid scope (not in MetaApiScope union)", async () => {
    // @ts-expect-error — intentional invalid scope
    await expect(mintJwt(["invalid:scope"])).rejects.toThrow(/scope/i);
  });

  it("encodes kid header correctly", async () => {
    const jwt = await mintJwt(["webhooks:read"]);
    const headerB64 = jwt.split(".")[0]!;
    const header = JSON.parse(Buffer.from(headerB64, "base64url").toString("utf8"));
    expect(header.kid).toBe(process.env.META_API_KEY_ID);
    expect(header.alg).toBe("RS256");
  });

  it("iat is recent (within 5s of now)", async () => {
    const before = Math.floor(Date.now() / 1000);
    const jwt = await mintJwt(["webhooks:read"]);
    const after = Math.floor(Date.now() / 1000);
    const spki = await importSPKI(publicKey, "RS256");
    const { payload } = await jwtVerify(jwt, spki, {
      audience: "bevox-meta-api",
      issuer: process.env.META_API_APP_ID,
    });
    expect(payload.iat).toBeGreaterThanOrEqual(before);
    expect(payload.iat).toBeLessThanOrEqual(after);
  });
});
