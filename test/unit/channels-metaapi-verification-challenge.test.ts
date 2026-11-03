import { describe, expect, it } from "vitest";

import { handleVerificationChallenge } from "@/modules/channels/metaapi/service.js";

describe("handleVerificationChallenge", () => {
  it("echoes the challenge value", () => {
    const r = handleVerificationChallenge({ verification_challenge: "abc123" });
    expect(r.challenge).toBe("abc123");
  });

  it("handles long challenges", () => {
    const long = "x".repeat(128);
    const r = handleVerificationChallenge({ verification_challenge: long });
    expect(r.challenge).toBe(long);
  });

  it("preserves special characters verbatim", () => {
    const r = handleVerificationChallenge({ verification_challenge: "abc-123_XYZ.=" });
    expect(r.challenge).toBe("abc-123_XYZ.=");
  });
});
