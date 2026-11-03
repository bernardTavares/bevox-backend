import { describe, expect, it } from "vitest";
import { createAppointmentBody, availabilityQuery, idParam } from "@/modules/calendar/schemas.js";

describe("calendar schemas", () => {
  it("createAppointmentBody exige service_id uuid + date + start_time", () => {
    expect(createAppointmentBody.safeParse({}).success).toBe(false);
    expect(
      createAppointmentBody.safeParse({
        service_id: "0190d1a0-0000-7000-8000-000000000000",
        date: "2026-06-01",
        start_time: "09:00",
      }).success,
    ).toBe(true);
    expect(
      createAppointmentBody.safeParse({
        service_id: "x",
        date: "2026-06-01",
        start_time: "09:00",
      }).success,
    ).toBe(false);
  });
  it("date deve ser YYYY-MM-DD e start_time HH:MM", () => {
    expect(
      availabilityQuery.safeParse({
        service_id: "0190d1a0-0000-7000-8000-000000000000",
        date_from: "2026-6-1",
        date_to: "2026-06-02",
      }).success,
    ).toBe(false);
    expect(
      availabilityQuery.safeParse({
        service_id: "0190d1a0-0000-7000-8000-000000000000",
        date_from: "2026-06-01",
        date_to: "2026-06-02",
      }).success,
    ).toBe(true);
  });
  it("availabilityQuery rejeita range invertido e span > 92 dias, aceita span normal", () => {
    const sid = "0190d1a0-0000-7000-8000-000000000000";
    expect(
      availabilityQuery.safeParse({
        service_id: sid,
        date_from: "2026-06-10",
        date_to: "2026-06-01",
      }).success,
    ).toBe(false);
    expect(
      availabilityQuery.safeParse({
        service_id: sid,
        date_from: "2026-01-01",
        date_to: "2026-12-31",
      }).success,
    ).toBe(false);
    expect(
      availabilityQuery.safeParse({
        service_id: sid,
        date_from: "2026-06-01",
        date_to: "2026-06-30",
      }).success,
    ).toBe(true);
  });
  it("createAppointmentBody .strict() rejeita chaves desconhecidas", () => {
    expect(
      createAppointmentBody.safeParse({
        service_id: "0190d1a0-0000-7000-8000-000000000000",
        date: "2026-06-01",
        start_time: "09:00",
        unknown_key: 1,
      }).success,
    ).toBe(false);
  });
  it("idParam exige uuid", () => {
    expect(idParam.safeParse({ id: "nope" }).success).toBe(false);
  });
});
