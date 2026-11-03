import { describe, expect, it } from "vitest";
import {
  validateServicePackageInput,
  buildCustomerPackageFromGrant,
  canDecrement,
  addDaysISO,
  toIsoDate,
} from "@/modules/payments/package-intent.js";

describe("validateServicePackageInput (Zod strict, P4 catálogo)", () => {
  it("aceita input mínimo válido (name + sessions_included + price_amount)", () => {
    const r = validateServicePackageInput({
      name: "Pacote 10 sessões",
      sessions_included: 10,
      price_amount: 800,
    });
    expect(r.success).toBe(true);
  });
  it("aceita input completo com service_id + validity_days", () => {
    const r = validateServicePackageInput({
      name: "Pacote semestral",
      service_id: "f47ac10b-58cc-4372-a567-0e02b2c3d479",
      sessions_included: 20,
      price_amount: 1500.5,
      validity_days: 180,
    });
    expect(r.success).toBe(true);
  });
  it("rejeita name vazio", () => {
    expect(
      validateServicePackageInput({ name: "", sessions_included: 10, price_amount: 800 }).success,
    ).toBe(false);
  });
  it("rejeita name > 120 chars", () => {
    expect(
      validateServicePackageInput({
        name: "x".repeat(121),
        sessions_included: 10,
        price_amount: 800,
      }).success,
    ).toBe(false);
  });
  it("rejeita sessions_included = 0 / negativo / float", () => {
    expect(
      validateServicePackageInput({ name: "P", sessions_included: 0, price_amount: 800 }).success,
    ).toBe(false);
    expect(
      validateServicePackageInput({ name: "P", sessions_included: -1, price_amount: 800 }).success,
    ).toBe(false);
    expect(
      validateServicePackageInput({ name: "P", sessions_included: 1.5, price_amount: 800 }).success,
    ).toBe(false);
  });
  it("rejeita price_amount = 0 / negativo / Infinity", () => {
    expect(
      validateServicePackageInput({ name: "P", sessions_included: 10, price_amount: 0 }).success,
    ).toBe(false);
    expect(
      validateServicePackageInput({ name: "P", sessions_included: 10, price_amount: -1 }).success,
    ).toBe(false);
    expect(
      validateServicePackageInput({
        name: "P",
        sessions_included: 10,
        price_amount: Number.POSITIVE_INFINITY,
      }).success,
    ).toBe(false);
  });
  it("rejeita validity_days = 0 / negativo / float", () => {
    const base = { name: "P", sessions_included: 10, price_amount: 800 };
    expect(validateServicePackageInput({ ...base, validity_days: 0 }).success).toBe(false);
    expect(validateServicePackageInput({ ...base, validity_days: -1 }).success).toBe(false);
    expect(validateServicePackageInput({ ...base, validity_days: 1.5 }).success).toBe(false);
  });
  it("rejeita service_id formato inválido", () => {
    expect(
      validateServicePackageInput({
        name: "P",
        sessions_included: 10,
        price_amount: 800,
        service_id: "not-uuid",
      }).success,
    ).toBe(false);
  });
  it("rejeita chave extra desconhecida (strict fail-closed)", () => {
    expect(
      validateServicePackageInput({ name: "P", sessions_included: 10, price_amount: 800, bogus: 1 })
        .success,
    ).toBe(false);
  });
  it("rejeita params vazio", () => {
    expect(validateServicePackageInput({}).success).toBe(false);
  });
});

describe("buildCustomerPackageFromGrant (mapper puro, sem IO)", () => {
  const sp = {
    id: "f47ac10b-58cc-4372-a567-0e02b2c3d479",
    organization_id: "00000000-0000-4000-8000-000000000001",
    name: "Pacote 10",
    service_id: null,
    // M5-P2a Item 6 (T3): sessions_included agora number (post-migration 0015).
    sessions_included: 10,
    price_amount: "800.00",
    validity_days: null,
    is_active: true,
    created_at: new Date("2026-01-01T00:00:00Z"),
    updated_at: new Date("2026-01-01T00:00:00Z"),
  };
  const ch = {
    id: "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
    organization_id: "00000000-0000-4000-8000-000000000001",
    customer_id: "b3b4d5e6-58cc-4372-a567-0e02b2c3d479",
    appointment_id: null,
    service_id: null,
    professional_id: null,
    payment_account_id: "00000000-0000-4000-8000-000000000002",
    charge_type: "package" as const,
    status: "paid",
    amount_total: "800.00",
    amount_platform_fee: "24.00",
    currency: "BRL",
    provider_charge_id: "pi_test",
    payment_method: "pix" as const,
    expires_at: null,
    paid_at: new Date("2026-05-19T12:00:00Z"),
  };
  it("happy path sem validity_days → valid_until null", () => {
    const out = buildCustomerPackageFromGrant({ servicePackage: sp, charge: ch });
    expect(out.organization_id).toBe(sp.organization_id);
    expect(out.customer_id).toBe(ch.customer_id);
    expect(out.service_package_id).toBe(sp.id);
    expect(out.charge_id).toBe(ch.id);
    // M5-P2a Item 6 (T3): sessions_* agora number (post-migration 0015).
    expect(out.sessions_total).toBe(10);
    expect(out.sessions_used).toBe(0);
    expect(out.sessions_remaining).toBe(10);
    expect(out.status).toBe("active");
    expect(out.valid_until).toBeNull();
  });
  it("happy path com validity_days → valid_until = paid_at + N dias (ISO date)", () => {
    const spExp = { ...sp, validity_days: "180" };
    const out = buildCustomerPackageFromGrant({ servicePackage: spExp, charge: ch });
    expect(out.valid_until).toBe("2026-11-15");
  });
  it("lança quando customer_id é null", () => {
    const chNoCust = { ...ch, customer_id: null as unknown as string };
    expect(() => buildCustomerPackageFromGrant({ servicePackage: sp, charge: chNoCust })).toThrow(
      /customer_id/,
    );
  });
  it("lança quando paid_at é null mas validity_days é set", () => {
    const spExp = { ...sp, validity_days: "180" };
    const chNoPaid = { ...ch, paid_at: null };
    expect(() =>
      buildCustomerPackageFromGrant({ servicePackage: spExp, charge: chNoPaid }),
    ).toThrow(/paid_at/);
  });
});

describe("canDecrement (predicate puro fail-closed)", () => {
  const base = {
    id: "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
    organization_id: "00000000-0000-4000-8000-000000000001",
    customer_id: "b3b4d5e6-58cc-4372-a567-0e02b2c3d479",
    service_package_id: "f47ac10b-58cc-4372-a567-0e02b2c3d479",
    charge_id: "c0c0c0c0-58cc-4372-a567-0e02b2c3d479",
    status: "active",
    // M5-P2a Item 6 (T3): sessions_* agora number (post-migration 0015).
    sessions_total: 10,
    sessions_used: 0,
    sessions_remaining: 10,
    valid_until: null as string | null,
    created_at: new Date(),
    updated_at: new Date(),
  };
  it("ok quando active, sem expiry, com remaining", () => {
    expect(canDecrement(base, "2026-05-19")).toEqual({ ok: true });
  });
  it("ok quando valid_until === nowIsoDate (boundary inclusive)", () => {
    expect(canDecrement({ ...base, valid_until: "2026-05-19" }, "2026-05-19")).toEqual({
      ok: true,
    });
  });
  it("reason inactive quando status !== active", () => {
    expect(canDecrement({ ...base, status: "exhausted" }, "2026-05-19")).toEqual({
      ok: false,
      reason: "inactive",
    });
    expect(canDecrement({ ...base, status: "expired" }, "2026-05-19")).toEqual({
      ok: false,
      reason: "inactive",
    });
    expect(canDecrement({ ...base, status: "cancelled" }, "2026-05-19")).toEqual({
      ok: false,
      reason: "inactive",
    });
  });
  it("reason expired quando valid_until < nowIsoDate", () => {
    expect(canDecrement({ ...base, valid_until: "2026-05-18" }, "2026-05-19")).toEqual({
      ok: false,
      reason: "expired",
    });
  });
  it("reason exhausted quando sessions_remaining <= 0", () => {
    expect(canDecrement({ ...base, sessions_remaining: 0 }, "2026-05-19")).toEqual({
      ok: false,
      reason: "exhausted",
    });
  });
});

describe("addDaysISO (date arithmetic determinística)", () => {
  it("day=0 retorna a mesma data", () => {
    expect(addDaysISO("2026-05-19", 0)).toBe("2026-05-19");
  });
  it("positivo dentro mês", () => {
    expect(addDaysISO("2026-05-19", 5)).toBe("2026-05-24");
  });
  it("ultrapassando mês (May 30 + 5 = Jun 4)", () => {
    expect(addDaysISO("2026-05-30", 5)).toBe("2026-06-04");
  });
  it("Feb 28 → Mar 1 (não-bissexto)", () => {
    expect(addDaysISO("2027-02-28", 1)).toBe("2027-03-01");
  });
  it("Feb 29 ano bissexto", () => {
    expect(addDaysISO("2024-02-28", 1)).toBe("2024-02-29");
  });
  it("ano-novo Dec 31 → Jan 1", () => {
    expect(addDaysISO("2026-12-31", 1)).toBe("2027-01-01");
  });
});

describe("toIsoDate (Date → YYYY-MM-DD UTC)", () => {
  it("extrai date part de UTC midnight", () => {
    expect(toIsoDate(new Date("2026-05-19T00:00:00Z"))).toBe("2026-05-19");
  });
  it("extrai date part de UTC noon", () => {
    expect(toIsoDate(new Date("2026-05-19T12:00:00Z"))).toBe("2026-05-19");
  });
  it("aceita string ISO date-only", () => {
    expect(toIsoDate("2026-05-19")).toBe("2026-05-19");
  });
  it("aceita string ISO com Z", () => {
    expect(toIsoDate("2026-05-19T12:00:00Z")).toBe("2026-05-19");
  });
});
