/**
 * M5-P2a Item 6 — T3 type tests confirming sessions_* columns são number
 * pós-migration 0015 (numeric → integer). pg-types text protocol retorna
 * INTEGER como JS number imediato após ALTER COLUMN — TS row types devem
 * refletir essa realidade ao invés do decimal-string idiom legado.
 * Spec: docs/superpowers/specs/2026-05-21-backend-m5-p2-tech-debt-design.md §4.3
 */
import { describe, expectTypeOf, it } from "vitest";
import type { CustomerPackageRow, ServicePackageRow } from "@/modules/payments/repository.js";

describe("M5-P2a Item 6 numeric→integer types (T3)", () => {
  it("CustomerPackageRow.sessions_total is number", () => {
    expectTypeOf<CustomerPackageRow["sessions_total"]>().toBeNumber();
  });
  it("CustomerPackageRow.sessions_used is number", () => {
    expectTypeOf<CustomerPackageRow["sessions_used"]>().toBeNumber();
  });
  it("CustomerPackageRow.sessions_remaining is number", () => {
    expectTypeOf<CustomerPackageRow["sessions_remaining"]>().toBeNumber();
  });
  it("ServicePackageRow.sessions_included is number", () => {
    expectTypeOf<ServicePackageRow["sessions_included"]>().toBeNumber();
  });
});
