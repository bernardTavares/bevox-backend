import { describe, expect, it } from "vitest";
import {
  resolvePlatformFee,
  buildPixPaymentIntentParams,
  validateChargeInput,
  extractPixDisplay,
  mapRefundStatus,
  isFullRefund,
  isCheckoutPath,
  ONLINE_PAYMENT_METHODS,
} from "@/modules/payments/charge-intent.js";

describe("resolvePlatformFee (centavos, half-up, default 0 — P3a)", () => {
  it("default 0 quando split_config_json null", () => {
    expect(resolvePlatformFee(100, null)).toBe(0);
  });
  it("default 0 quando config corrompida / sem percent", () => {
    expect(resolvePlatformFee(100, { foo: "bar" })).toBe(0);
    expect(resolvePlatformFee(100, "not-an-object")).toBe(0);
  });
  it("usa platform_fee_percent quando presente", () => {
    expect(resolvePlatformFee(200, { platform_fee_percent: 5 })).toBe(1000); // 10.00
  });
  it("aceita string numérica", () => {
    expect(resolvePlatformFee(100, { platform_fee_percent: "3" })).toBe(300);
  });
  it("half-up em valor quebrado", () => {
    expect(resolvePlatformFee(99.99, { platform_fee_percent: 3 })).toBe(300);
  });
  it("0 é override legítimo (guard n>=0, ADR-018 ### 4) → fee 0", () => {
    expect(resolvePlatformFee(100, { platform_fee_percent: 0 })).toBe(0);
  });
  it("percent inválido (negativo/NaN) cai no fallback 0", () => {
    expect(resolvePlatformFee(100, { platform_fee_percent: -1 })).toBe(0);
    expect(resolvePlatformFee(100, { platform_fee_percent: "x" })).toBe(0);
  });
  it("percent fora da política (> 30%) → fallback 0; 30% é o teto inclusivo", () => {
    expect(resolvePlatformFee(150, { platform_fee_percent: 99.99 })).toBe(0);
    expect(resolvePlatformFee(150, { platform_fee_percent: 50 })).toBe(0);
    expect(resolvePlatformFee(100, { platform_fee_percent: 30 })).toBe(3000);
  });
});

describe("buildPixPaymentIntentParams (determinístico)", () => {
  it("monta os params Pix destination+fee corretos", () => {
    const p = buildPixPaymentIntentParams({
      amountTotal: 150,
      feeCents: 450,
      destination: "acct_PRO",
      organizationId: "org-1",
      chargeId: "chg-1",
      idempotencyKey: "idem-1",
      expiresAfterSeconds: 14400,
    });
    expect(p.amount).toBe(15000);
    expect(p.currency).toBe("brl");
    expect(p.payment_method_types).toEqual(["pix"]);
    expect(p.application_fee_amount).toBe(450);
    expect(p.transfer_data).toEqual({ destination: "acct_PRO" });
    expect(p.metadata).toEqual({
      organization_id: "org-1",
      charge_id: "chg-1",
      idempotency_key: "idem-1",
    });
    expect(
      (p.payment_method_options?.pix as { expires_after_seconds?: number })?.expires_after_seconds,
    ).toBe(14400);
    // Pix é client-confirmed: NÃO há confirm/payment_method/on_behalf_of.
    expect("confirm" in p).toBe(false);
    expect("on_behalf_of" in p).toBe(false);
  });
  it("rejeita feeCents fora de [0, amount] (invariante Stripe, fail-closed)", () => {
    const base = {
      amountTotal: 150,
      destination: "acct_PRO",
      organizationId: "org-1",
      chargeId: "chg-1",
      idempotencyKey: "idem-1",
      expiresAfterSeconds: 14400,
    };
    // fee > amount (15000) → RangeError
    expect(() => buildPixPaymentIntentParams({ ...base, feeCents: 15001 })).toThrow(RangeError);
    // fee negativo → RangeError
    expect(() => buildPixPaymentIntentParams({ ...base, feeCents: -1 })).toThrow(RangeError);
    // fee não-inteiro → RangeError
    expect(() => buildPixPaymentIntentParams({ ...base, feeCents: 4.5 })).toThrow(RangeError);
    // feeCents 0 → application_fee_amount OMITIDO (padrão Stripe "sem fee"); transfer_data permanece
    const zero = buildPixPaymentIntentParams({ ...base, feeCents: 0 });
    expect("application_fee_amount" in zero).toBe(false);
    expect(zero.transfer_data).toEqual({ destination: "acct_PRO" });
    // limite superior válido: exatamente amount → presente
    expect(buildPixPaymentIntentParams({ ...base, feeCents: 15000 }).application_fee_amount).toBe(
      15000,
    );
  });
});

describe("validateChargeInput (Zod strict; P2 charge_type full|package; enum payment_method pix|checkout)", () => {
  const ok = {
    customer_id: "f47ac10b-58cc-4372-a567-0e02b2c3d479",
    amount_total: 120.5,
    charge_type: "full",
  };
  it("aceita input mínimo válido e aplica defaults", () => {
    const r = validateChargeInput(ok);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.currency).toBe("BRL");
      expect(r.data.payment_method).toBe("pix");
    }
  });
  it("rejeita charge_type != full (P2)", () => {
    expect(validateChargeInput({ ...ok, charge_type: "deposit" }).success).toBe(false);
  });
  it("rejeita amount_total <= 0", () => {
    expect(validateChargeInput({ ...ok, amount_total: 0 }).success).toBe(false);
  });
  it("rejeita chave extra desconhecida (strict fail-closed)", () => {
    expect(validateChargeInput({ ...ok, bogus: 1 }).success).toBe(false);
  });
  it("rejeita params vazio", () => {
    expect(validateChargeInput({}).success).toBe(false);
  });
  it("aceita payment_method='pix' explícito", () => {
    const r = validateChargeInput({ ...ok, payment_method: "pix" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.payment_method).toBe("pix");
  });
  // POC payment-link-stripe-checkout-not-implemented: schema aceita `checkout`
  // (PRD §5.6 / ADR-014) — caller resolve o 501. Distinção 400 vs 501.
  it("aceita payment_method='checkout' (foundation; caller resolve 501)", () => {
    const r = validateChargeInput({ ...ok, payment_method: "checkout" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.payment_method).toBe("checkout");
  });
  it("rejeita payment_method desconhecido (enum fail-closed)", () => {
    expect(validateChargeInput({ ...ok, payment_method: "card" }).success).toBe(false);
    expect(validateChargeInput({ ...ok, payment_method: "boleto" }).success).toBe(false);
    expect(validateChargeInput({ ...ok, payment_method: "manual" }).success).toBe(false);
  });
  it("ONLINE_PAYMENT_METHODS é a fonte do enum (pix + checkout, nada além)", () => {
    expect([...ONLINE_PAYMENT_METHODS].sort()).toEqual(["checkout", "pix"]);
  });
});

describe("isCheckoutPath (POC payment-link-stripe-checkout-not-implemented)", () => {
  it("true para checkout", () => {
    expect(isCheckoutPath({ payment_method: "checkout" })).toBe(true);
  });
  it("false para pix", () => {
    expect(isCheckoutPath({ payment_method: "pix" })).toBe(false);
  });
});

describe("extractPixDisplay (mapeamento pinado do next_action)", () => {
  it("mapeia .data/.image_url_png/.expires_at/.hosted_instructions_url", () => {
    const pi = {
      id: "pi_1",
      next_action: {
        pix_display_qr_code: {
          data: "000201COPYPASTE",
          image_url_png: "https://stripe/png",
          image_url_svg: "https://stripe/svg",
          expires_at: 1893456000,
          hosted_instructions_url: "https://stripe/hosted",
        },
      },
    };
    const d = extractPixDisplay(pi);
    expect(d).not.toBeNull();
    expect(d!.copy_paste).toBe("000201COPYPASTE");
    expect(d!.qr_code).toBe("https://stripe/png");
    expect(d!.hosted_instructions_url).toBe("https://stripe/hosted");
    expect(d!.expires_at.getTime()).toBe(1893456000 * 1000);
  });
  it("retorna null se next_action ausente", () => {
    expect(extractPixDisplay({ id: "pi_x", next_action: null })).toBeNull();
    expect(extractPixDisplay({ id: "pi_x" })).toBeNull();
  });
  it("retorna null se expires_at inválido (0/negativo) — fail-closed", () => {
    // Hardening (charge-flow audit): expires_at gateia a expiração da
    // charge; 0/negativo não pode virar uma charge já-expirada.
    const mk = (expires_at: number) => ({
      id: "pi_x",
      next_action: {
        pix_display_qr_code: {
          data: "X",
          image_url_png: "https://s/png",
          expires_at,
        },
      },
    });
    expect(extractPixDisplay(mk(0))).toBeNull();
    expect(extractPixDisplay(mk(-1))).toBeNull();
  });
});

describe("mapRefundStatus / isFullRefund", () => {
  it("mapeia status Stripe → enum canon refunds", () => {
    expect(mapRefundStatus("succeeded")).toBe("succeeded");
    expect(mapRefundStatus("pending")).toBe("pending");
    expect(mapRefundStatus("failed")).toBe("failed");
    expect(mapRefundStatus("canceled")).toBe("failed");
    expect(mapRefundStatus("requires_action")).toBe("pending");
    expect(mapRefundStatus(undefined)).toBe("pending");
  });
  it("isFullRefund: refund.amount(cents) == charge.amount_total*100", () => {
    expect(isFullRefund(15000, "150.00")).toBe(true);
    expect(isFullRefund(5000, "150.00")).toBe(false);
    expect(isFullRefund(15000, "150")).toBe(true);
  });
});
