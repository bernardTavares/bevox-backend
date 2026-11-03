import { describe, expect, it } from "vitest";
import { selectBestCandidates, type WaitlistCandidate } from "@/modules/calendar/waitlist/match.js";
import { parseWaitlistPolicy } from "@/modules/calendar/waitlist/policy.js";

function cand(p: Partial<WaitlistCandidate>): WaitlistCandidate {
  return {
    id: p.id ?? "00000000-0000-0000-0000-000000000001",
    service_id: p.service_id ?? null,
    professional_id: p.professional_id ?? null,
    preferred_date_from: p.preferred_date_from ?? null,
    preferred_date_to: p.preferred_date_to ?? null,
    preferred_time_from: p.preferred_time_from ?? null,
    preferred_time_to: p.preferred_time_to ?? null,
    priority_score: p.priority_score ?? "0",
    priority: p.priority ?? 0,
    position: p.position ?? null,
    created_at: p.created_at ?? new Date("2026-01-01T00:00:00Z"),
  };
}
const slot = {
  slot_start_at: new Date("2026-06-10T14:30:00Z"),
  service_id: "svc-1",
  professional_id: "prof-1",
};
const pol = parseWaitlistPolicy(null);

describe("selectBestCandidates", () => {
  it("filters out entries whose preference window excludes the slot", () => {
    const out = selectBestCandidates(
      [
        cand({
          id: "in",
          preferred_date_from: "2026-06-01",
          preferred_date_to: "2026-06-30",
          service_id: "svc-1",
        }),
        cand({
          id: "outDate",
          preferred_date_from: "2026-07-01",
          preferred_date_to: "2026-07-30",
          service_id: "svc-1",
        }),
        cand({
          id: "outTime",
          preferred_time_from: "08:00",
          preferred_time_to: "09:00",
          service_id: "svc-1",
        }),
      ],
      slot,
      pol,
    );
    expect(out.map((c) => c.id)).toEqual(["in"]);
  });

  it("service_eligibility=exact requires same service_id", () => {
    const out = selectBestCandidates(
      [cand({ id: "match", service_id: "svc-1" }), cand({ id: "other", service_id: "svc-2" })],
      slot,
      pol,
    );
    expect(out.map((c) => c.id)).toEqual(["match"]);
  });

  it("professional_preference=required excludes non-matching professional", () => {
    const p = parseWaitlistPolicy({ professional_preference: "required" });
    const out = selectBestCandidates(
      [
        cand({ id: "ok", service_id: "svc-1", professional_id: "prof-1" }),
        cand({ id: "no", service_id: "svc-1", professional_id: "prof-2" }),
      ],
      slot,
      p,
    );
    expect(out.map((c) => c.id)).toEqual(["ok"]);
  });

  it("professional_preference=preferred orders matching professional first but keeps others", () => {
    const out = selectBestCandidates(
      [
        cand({ id: "noprof", service_id: "svc-1", professional_id: "prof-9", priority_score: "5" }),
        cand({
          id: "withprof",
          service_id: "svc-1",
          professional_id: "prof-1",
          priority_score: "1",
        }),
      ],
      slot,
      pol,
    );
    expect(out.map((c) => c.id)).toEqual(["withprof", "noprof"]);
  });

  it("deterministic order: priority_score desc, then priority desc, then position asc, then created_at asc, then id", () => {
    const out = selectBestCandidates(
      [
        cand({
          id: "b",
          service_id: "svc-1",
          professional_id: "prof-1",
          priority_score: "10",
          priority: 1,
        }),
        cand({
          id: "a",
          service_id: "svc-1",
          professional_id: "prof-1",
          priority_score: "10",
          priority: 5,
        }),
        cand({ id: "c", service_id: "svc-1", professional_id: "prof-1", priority_score: "3" }),
      ],
      slot,
      pol,
    );
    expect(out.map((c) => c.id)).toEqual(["a", "b", "c"]);
  });

  it("service_eligibility=any ignores service mismatch", () => {
    const p = parseWaitlistPolicy({
      service_eligibility: "any",
      professional_preference: "ignore",
    });
    const out = selectBestCandidates([cand({ id: "x", service_id: "svc-99" })], slot, p);
    expect(out.map((c) => c.id)).toEqual(["x"]);
  });

  it("lower-precedence tiebreaks: position asc, then created_at asc, then id", () => {
    const base = {
      service_id: "svc-1",
      professional_id: "prof-1",
      priority_score: "0",
      priority: 0,
    };
    const out = selectBestCandidates(
      [
        cand({ ...base, id: "z", position: 2 }),
        cand({ ...base, id: "y", position: 1 }),
        cand({ ...base, id: "x", position: 1, created_at: new Date("2026-02-01T00:00:00Z") }),
        cand({ ...base, id: "w", position: null, created_at: new Date("2025-12-01T00:00:00Z") }),
        cand({ ...base, id: "v", position: null, created_at: new Date("2025-12-01T00:00:00Z") }),
      ],
      slot,
      pol,
    );
    // position 1 before 2; within pos 1, created_at asc (y=2026-01 before x=2026-02);
    // null position last; within nulls equal created_at, id asc (v before w).
    expect(out.map((c) => c.id)).toEqual(["y", "x", "z", "v", "w"]);
  });
});
