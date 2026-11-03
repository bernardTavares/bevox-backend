import { describe, expect, it } from "vitest";

import { parseRoutingConfig } from "@/modules/channels/routing-config.schema.js";

describe("routing-config canonical contract", () => {
  it("parses the full 3-consumer slice", () => {
    const c = parseRoutingConfig({
      webhook_secret_ref: "WH_SECRET",
      allowed_event_types: ["message_created"],
      ai_mode_override: "copilot",
      buffer_enabled: true,
      buffer_cutoff_seconds: 45,
      processing_endpoint_url: "https://h.example/run",
    });
    expect(c.webhook_secret_ref).toBe("WH_SECRET");
    expect(c.allowed_event_types).toEqual(["message_created"]);
    expect(c.ai_mode_override).toBe("copilot");
    expect(c.buffer_cutoff_seconds).toBe(45);
  });
  it("never throws; invalid → {}", () => {
    expect(parseRoutingConfig(undefined)).toEqual({});
    expect(parseRoutingConfig({ ai_mode_override: "bogus" })).toEqual({});
  });
  it("a single typed-invalid field collapses the whole parse to {}", () => {
    expect(parseRoutingConfig({ webhook_secret_ref: "X", buffer_cutoff_seconds: -1 })).toEqual({});
  });
  it("passthrough keeps unknown future keys", () => {
    const c = parseRoutingConfig({ future_key: 1 }) as Record<string, unknown>;
    expect(c.future_key).toBe(1);
  });
});
