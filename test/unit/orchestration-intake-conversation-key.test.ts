import { describe, expect, it } from "vitest";

import { parseConversationKey } from "@/modules/orchestration/intake.js";

describe("parseConversationKey — new 4-segment 'channel:' format", () => {
  it("parses standard channel:wa:eid:convId", () => {
    const r = parseConversationKey("channel:wa:eid_xyz:conv_abc");
    expect(r.provider).toBe("wa");
    expect(r.externalConversationId).toBe("conv_abc");
  });

  it("preserves extra colons in convId via slice(3).join(':')", () => {
    const r = parseConversationKey("channel:ig:eid_xyz:conv_abc:extra");
    expect(r.provider).toBe("ig");
    expect(r.externalConversationId).toBe("conv_abc:extra");
  });
});

describe("parseConversationKey — defensive fallbacks", () => {
  it("malformed 1-segment passes provider verbatim, null convId", () => {
    const r = parseConversationKey("garbage");
    expect(r.provider).toBe("garbage");
    expect(r.externalConversationId).toBeNull();
  });

  it("empty string returns provider='', null convId", () => {
    const r = parseConversationKey("");
    expect(r.provider).toBe("");
    expect(r.externalConversationId).toBeNull();
  });
});
