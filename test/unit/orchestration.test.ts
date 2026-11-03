import { describe, expect, it } from "vitest";

import { DEFAULT_SYSTEM_PROMPT } from "@/modules/orchestration/constants.js";
import { directionToRole, resolveBufferSeconds } from "@/modules/orchestration/repository.js";

describe("directionToRole", () => {
  it("maps incoming→user, outgoing→assistant, unknown→user", () => {
    expect(directionToRole("incoming")).toBe("user");
    expect(directionToRole("outgoing")).toBe("assistant");
    expect(directionToRole("weird")).toBe("user");
  });
});

describe("resolveBufferSeconds (C seam > env default)", () => {
  it("uses channel buffer_cutoff_seconds when set", () => {
    expect(resolveBufferSeconds({ buffer_cutoff_seconds: 20 }, 45)).toBe(20);
  });
  it("uses channel seconds when buffer_enabled === true", () => {
    expect(resolveBufferSeconds({ buffer_enabled: true, buffer_cutoff_seconds: 20 }, 45)).toBe(20);
  });
  it("env default when buffer_enabled === false", () => {
    expect(resolveBufferSeconds({ buffer_enabled: false, buffer_cutoff_seconds: 20 }, 45)).toBe(45);
  });
  it("env default when routing config absent/invalid", () => {
    expect(resolveBufferSeconds(undefined, 45)).toBe(45);
    expect(resolveBufferSeconds({ foo: 1 }, 45)).toBe(45);
  });
  it("env default when buffer_cutoff_seconds non-positive", () => {
    // 0 fails the Zod positive() guard → parseRoutingConfig returns {} →
    // resolveBufferSeconds takes the absent-config path → env default.
    expect(resolveBufferSeconds({ buffer_cutoff_seconds: 0 }, 45)).toBe(45);
  });
});

describe("DEFAULT_SYSTEM_PROMPT", () => {
  it("is a non-empty safe canonical fallback (harness consumes verbatim)", () => {
    expect(DEFAULT_SYSTEM_PROMPT.length).toBeGreaterThan(20);
  });
});
