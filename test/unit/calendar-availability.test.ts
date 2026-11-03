import { describe, expect, it } from "vitest";
import { parseMinutes, formatTime, subtractInterval } from "@/modules/calendar/availability.js";

describe("availability time math", () => {
  it("parseMinutes HH:MM(:SS)", () => {
    expect(parseMinutes("09:30")).toBe(570);
    expect(parseMinutes("09:30:00")).toBe(570);
  });
  it("formatTime", () => {
    expect(formatTime(570)).toBe("09:30");
    expect(formatTime(605)).toBe("10:05");
  });
  it("subtractInterval remove o bloco, mantém remanescentes", () => {
    expect(subtractInterval([[540, 720]], 600, 660)).toEqual([
      [540, 600],
      [660, 720],
    ]);
    expect(subtractInterval([[540, 720]], 800, 900)).toEqual([[540, 720]]);
    expect(subtractInterval([[540, 720]], 540, 720)).toEqual([]);
  });
});
