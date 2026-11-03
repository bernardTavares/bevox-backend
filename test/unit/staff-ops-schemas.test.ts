import { describe, expect, it } from "vitest";
import {
  paginationSchema,
  actionBodySchema,
  auditQuerySchema,
} from "@/modules/staff-ops/schemas.js";

describe("staff-ops schemas", () => {
  it("paginationSchema clampa page≥1 perPage 1..100 default 1/20", () => {
    expect(paginationSchema.parse({})).toEqual({ page: 1, perPage: 20 });
    expect(paginationSchema.parse({ page: "0", per_page: "999" })).toEqual({
      page: 1,
      perPage: 100,
    });
    expect(paginationSchema.parse({ page: "3", per_page: "10" })).toEqual({ page: 3, perPage: 10 });
    expect(paginationSchema.parse({ page: "abc" }).page).toBe(1);
    expect(paginationSchema.parse({ page: "2.7" }).page).toBe(2);
    expect(paginationSchema.parse({ per_page: "-5" }).perPage).toBe(1);
  });
  it("actionBodySchema exige reason não-vazio", () => {
    expect(actionBodySchema.safeParse({}).success).toBe(false);
    expect(actionBodySchema.safeParse({ reason: " " }).success).toBe(false);
    expect(actionBodySchema.safeParse({ reason: "ok" }).success).toBe(true);
  });
  it("auditQuerySchema aceita filtros opcionais", () => {
    expect(auditQuerySchema.safeParse({}).success).toBe(true);
    expect(auditQuerySchema.safeParse({ organization_id: "o", action: "replay" }).success).toBe(
      true,
    );
  });
});
