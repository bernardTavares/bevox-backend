import { describe, expect, it } from "vitest";
import { slotIsFuture } from "@/modules/calendar/waitlist/repository.js";

describe("slotIsFuture (outbox enqueue gate)", () => {
  const now = new Date("2026-06-10T12:00:00Z");
  it("future slot → true", () => {
    expect(slotIsFuture(new Date("2026-06-10T13:00:00Z"), now)).toBe(true);
  });
  it("exactly now → true (>=)", () => {
    expect(slotIsFuture(new Date("2026-06-10T12:00:00Z"), now)).toBe(true);
  });
  it("past slot → false (no_show/completed inherently excluded)", () => {
    expect(slotIsFuture(new Date("2026-06-10T11:59:59Z"), now)).toBe(false);
  });
});
