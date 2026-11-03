import { describe, expect, it } from "vitest";
import { parseWaitlistPolicy } from "@/modules/calendar/waitlist/policy.js";

describe("parseWaitlistPolicy", () => {
  it("null → defaults (auto_book, exact, preferred, 120, default order)", () => {
    const p = parseWaitlistPolicy(null);
    expect(p).toEqual({
      mode: "auto_book",
      offer_window_minutes: 120,
      service_eligibility: "exact",
      professional_preference: "preferred",
      priority_order: ["priority_score", "priority", "position", "created_at"],
    });
  });

  it("partial json → fills missing with defaults", () => {
    const p = parseWaitlistPolicy({ mode: "offer", offer_window_minutes: 30 });
    expect(p.mode).toBe("offer");
    expect(p.offer_window_minutes).toBe(30);
    expect(p.service_eligibility).toBe("exact");
    expect(p.professional_preference).toBe("preferred");
  });

  it("invalid enum value → falls back to full defaults (never throws)", () => {
    const p = parseWaitlistPolicy({ mode: "bogus", professional_preference: 42 });
    expect(p.mode).toBe("auto_book");
    expect(p.professional_preference).toBe("preferred");
  });

  it("unknown extra keys ignored", () => {
    const p = parseWaitlistPolicy({ mode: "offer", extra: "x" });
    expect(p.mode).toBe("offer");
    expect("extra" in p).toBe(false);
  });

  it("returns independent priority_order arrays (no shared reference)", () => {
    const a = parseWaitlistPolicy(null);
    const b = parseWaitlistPolicy(null);
    expect(a.priority_order).not.toBe(b.priority_order);
    a.priority_order.push("priority");
    expect(b.priority_order).toEqual(["priority_score", "priority", "position", "created_at"]);
  });
});
