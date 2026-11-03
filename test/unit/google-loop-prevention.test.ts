import { describe, expect, it } from "vitest";

import { isOwnEcho } from "@/modules/calendar/google/sync.js";

describe("google loop-prevention (canon §5.5)", () => {
  const apptId = "0190d1a0-0000-7000-8000-000000000000";
  it("evento com bevox_appointment_id + mapping + updated≈synced±5s → eco (ignora)", () => {
    const synced = new Date("2026-06-01T10:00:00Z");
    const ev = {
      extendedProperties: { private: { bevox_appointment_id: apptId } },
      updated: "2026-06-01T10:00:03Z",
    };
    expect(isOwnEcho(ev, { appointment_id: apptId, synced_at: synced })).toBe(true);
  });
  it("evento externo SEM bevox_appointment_id → processa (não é eco)", () => {
    expect(isOwnEcho({ updated: "2026-06-01T10:00:03Z" }, null)).toBe(false);
  });
  it("bevox_appointment_id presente mas updated >> synced (10s) → NÃO é eco (mudança real)", () => {
    const synced = new Date("2026-06-01T10:00:00Z");
    const ev = {
      extendedProperties: { private: { bevox_appointment_id: apptId } },
      updated: "2026-06-01T10:00:10Z",
    };
    expect(isOwnEcho(ev, { appointment_id: apptId, synced_at: synced })).toBe(false);
  });
  it("etag igual → eco mesmo com drift grande (janela de tempo irrelevante)", () => {
    expect(
      isOwnEcho(
        {
          extendedProperties: { private: { bevox_appointment_id: apptId } },
          etag: 'W/"abc"',
          updated: "2026-06-01T11:00:00Z",
        },
        {
          appointment_id: apptId,
          synced_at: new Date("2026-06-01T10:00:00Z"),
          google_etag: 'W/"abc"',
        },
      ),
    ).toBe(true);
  });
  it("etag diferente → NÃO é eco mesmo dentro de 5s (edição externa não suprimida)", () => {
    expect(
      isOwnEcho(
        {
          extendedProperties: { private: { bevox_appointment_id: apptId } },
          etag: 'W/"NEW"',
          updated: "2026-06-01T10:00:02Z",
        },
        {
          appointment_id: apptId,
          synced_at: new Date("2026-06-01T10:00:00Z"),
          google_etag: 'W/"OLD"',
        },
      ),
    ).toBe(false);
  });
  it("tag ausente + etag presente → NÃO é eco (gate de tag primeiro)", () => {
    expect(isOwnEcho({ etag: 'W/"x"' }, null)).toBe(false);
  });
});
