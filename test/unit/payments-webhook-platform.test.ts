/**
 * M5-P4 T4: extração de `applyChargePaid` (service.ts) — orquestração
 * pós-pago compartilhada entre o webhook Stripe (payment_intent.succeeded)
 * e o futuro modo manual. Este teste blinda a EQUIVALÊNCIA BYTE-A-BYTE da
 * sequência dos SEIS efeitos que antes viviam inline no branch do webhook:
 *
 *   1. markChargePaid (guarded UPDATE WHERE status='pending')
 *   2. insertPayment (descriptor paid)
 *   3. confirmAppointmentIfUnconfirmed (só se appointment_id)
 *   4. insertChargeAudit (charge.paid / system)
 *   5. getChargeById (re-load p/ paid_at populado)
 *   6. grant (charge_type='package', best-effort)
 *
 * Mock no nível do módulo `repository.js` (precedente autonomy.test.ts) +
 * `withRedisLock` (executa o callback in-line) + logger. Um único log de
 * chamadas ordenado prova a sequência exata.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const calls: string[] = [];
// T5: estado mutável dos mocks de refund (lido lazy pela factory do vi.mock).
let refundedCentsMock = 0;
let cancelledMock = false;

vi.mock("@/modules/payments/repository.js", () => ({
  markChargePaid: vi.fn(async () => {
    calls.push("markChargePaid");
  }),
  insertPayment: vi.fn(async () => {
    calls.push("insertPayment");
  }),
  confirmAppointmentIfUnconfirmed: vi.fn(async () => {
    calls.push("confirmAppointmentIfUnconfirmed");
  }),
  insertChargeAudit: vi.fn(async (input: { action: string }) => {
    calls.push(`insertChargeAudit:${input.action}`);
  }),
  getChargeById: vi.fn(async () => {
    calls.push("getChargeById");
    return paidChargeRow;
  }),
  // grant path (charge_type='package')
  getCustomerPackageByChargeId: vi.fn(async () => null),
  getServicePackageById: vi.fn(async () => ({
    id: "sp-1",
    organization_id: "org-1",
    service_id: null,
    sessions_included: 10,
    validity_days: null,
    is_active: true,
  })),
  insertCustomerPackage: vi.fn(async () => {
    calls.push("insertCustomerPackage");
    return { id: "cp-1", alreadyGranted: false };
  }),
  insertPackageAudit: vi.fn(async () => {
    calls.push("insertPackageAudit");
  }),
  // applyChargeRefunded (T5) — soma persistida + transição full.
  sumSucceededRefundsCents: vi.fn(async () => {
    calls.push("sumSucceededRefundsCents");
    return refundedCentsMock;
  }),
  markChargeRefunded: vi.fn(async () => {
    calls.push("markChargeRefunded");
  }),
  markPaymentReversed: vi.fn(async () => {
    calls.push("markPaymentReversed");
  }),
  cancelCustomerPackageByChargeId: vi.fn(async () => {
    calls.push("cancelCustomerPackageByChargeId");
    return { cancelled: cancelledMock };
  }),
}));

vi.mock("@/modules/calendar/google/lock.js", () => ({
  withRedisLock: vi.fn(async (_key: string, _ttl: number, fn: () => Promise<unknown>) => fn()),
}));

vi.mock("@/shared/logger.js", () => ({
  logger: () => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn() }),
}));

import * as repo from "@/modules/payments/repository.js";
import { applyChargePaid, applyChargeRefunded } from "@/modules/payments/service.js";

const baseChargeRow = {
  id: "chg-1",
  organization_id: "org-1",
  customer_id: "cust-1",
  appointment_id: "appt-1",
  service_id: null,
  professional_id: null,
  payment_account_id: "pa-1",
  charge_type: "package",
  status: "pending",
  amount_total: "120.50",
  amount_platform_fee: null,
  currency: "BRL",
  provider_charge_id: "pi_123",
  payment_method: "pix",
  expires_at: null,
  paid_at: null,
  metadata: { service_package_id: "11111111-1111-4111-8111-111111111111" },
} as unknown as repo.ChargeRow;

// re-load (efeito 5) devolve a charge já com paid_at populado.
const paidChargeRow = {
  ...baseChargeRow,
  status: "paid",
  paid_at: new Date("2026-05-21T10:00:00Z"),
} as unknown as repo.ChargeRow;

const descriptor = {
  status: "paid" as const,
  providerPaymentId: "pi_123",
  amountPaid: 120.5,
  currency: "BRL",
  rawPayloadJson: { id: "evt_1", type: "payment_intent.succeeded" },
};

beforeEach(() => {
  calls.length = 0;
  refundedCentsMock = 0;
  cancelledMock = false;
  vi.clearAllMocks();
});

describe("applyChargePaid — 6 efeitos byte-equivalentes (package + appointment)", () => {
  it("dispara os SEIS efeitos na ordem exata do branch payment_intent.succeeded", async () => {
    const paidAt = new Date("2026-05-21T10:00:00Z");
    await applyChargePaid("org-1", baseChargeRow, paidAt, descriptor, {
      action: "charge.paid",
      actorType: "system",
    });

    // Ordem exata (markChargePaid → insertPayment → confirmAppointment →
    // audit → re-load → grant). O grant interno insere o CustomerPackage +
    // audita package.granted (efeito 6, best-effort).
    expect(calls).toEqual([
      "markChargePaid",
      "insertPayment",
      "confirmAppointmentIfUnconfirmed",
      "insertChargeAudit:charge.paid",
      "getChargeById",
      "insertCustomerPackage",
      "insertPackageAudit",
    ]);
  });

  it("markChargePaid recebe (orgId, chargeId, paidAt)", async () => {
    const paidAt = new Date("2026-05-21T10:00:00Z");
    await applyChargePaid("org-1", baseChargeRow, paidAt, descriptor, {
      action: "charge.paid",
      actorType: "system",
    });
    expect(repo.markChargePaid).toHaveBeenCalledWith("org-1", "chg-1", paidAt);
  });

  it("insertPayment recebe o descriptor paid (paidAt, valores, providerPaymentId)", async () => {
    const paidAt = new Date("2026-05-21T10:00:00Z");
    await applyChargePaid("org-1", baseChargeRow, paidAt, descriptor, {
      action: "charge.paid",
      actorType: "system",
    });
    expect(repo.insertPayment).toHaveBeenCalledWith({
      organizationId: "org-1",
      chargeId: "chg-1",
      status: "paid",
      providerPaymentId: "pi_123",
      amountPaid: 120.5,
      currency: "BRL",
      paidAt,
      rawPayloadJson: descriptor.rawPayloadJson,
    });
  });

  it("insertChargeAudit usa action/actorType do ctx + afterJson canônico", async () => {
    await applyChargePaid("org-1", baseChargeRow, new Date(), descriptor, {
      action: "charge.paid",
      actorType: "system",
    });
    expect(repo.insertChargeAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-1",
        chargeId: "chg-1",
        action: "charge.paid",
        actorType: "system",
        afterJson: { provider_payment_id: "pi_123", status: "paid" },
      }),
    );
  });

  it("ctx manual (actorId/reason) é propagado ao audit", async () => {
    await applyChargePaid("org-1", baseChargeRow, new Date(), descriptor, {
      action: "charge.marked_paid_manual",
      actorType: "user",
      actorId: "user-9",
      reason: "recebido em dinheiro",
    });
    expect(repo.insertChargeAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "charge.marked_paid_manual",
        actorType: "user",
        actorId: "user-9",
        reasonText: "recebido em dinheiro",
      }),
    );
  });
});

describe("applyChargePaid — branches condicionais", () => {
  it("sem appointment_id NÃO chama confirmAppointmentIfUnconfirmed", async () => {
    const noAppt = { ...baseChargeRow, appointment_id: null } as unknown as repo.ChargeRow;
    await applyChargePaid("org-1", noAppt, new Date(), descriptor, {
      action: "charge.paid",
      actorType: "system",
    });
    expect(repo.confirmAppointmentIfUnconfirmed).not.toHaveBeenCalled();
  });

  it("charge_type != package NÃO re-carrega nem concede pacote", async () => {
    const fullCharge = { ...baseChargeRow, charge_type: "full" } as unknown as repo.ChargeRow;
    await applyChargePaid("org-1", fullCharge, new Date(), descriptor, {
      action: "charge.paid",
      actorType: "system",
    });
    expect(repo.getChargeById).not.toHaveBeenCalled();
    expect(repo.insertCustomerPackage).not.toHaveBeenCalled();
  });
});

describe("applyChargeRefunded — full-vs-partial pela SOMA persistida (T5)", () => {
  // amount_total "120.50" → totalCents 12050. Soma persistida 'succeeded'
  // decide full (gate: só rows succeeded contam, via sumSucceededRefundsCents).
  it("(a) full single de pacote: flip charge/payment + cancel + package audit", async () => {
    refundedCentsMock = 12050; // == totalCents → full
    cancelledMock = true;
    vi.mocked(repo.getCustomerPackageByChargeId).mockResolvedValueOnce({
      id: "cp-1",
    } as unknown as Awaited<ReturnType<typeof repo.getCustomerPackageByChargeId>>);

    await applyChargeRefunded("org-1", baseChargeRow, {
      action: "charge.refund_recorded",
      actorType: "system",
      providerRefundId: "re_1",
    });

    expect(calls).toEqual([
      "sumSucceededRefundsCents",
      "markChargeRefunded",
      "markPaymentReversed",
      "cancelCustomerPackageByChargeId",
      "insertPackageAudit",
    ]);
    expect(repo.markChargeRefunded).toHaveBeenCalledWith("org-1", "chg-1");
    expect(repo.markPaymentReversed).toHaveBeenCalledWith("org-1", "chg-1");
    expect(repo.insertPackageAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-1",
        customerPackageId: "cp-1",
        action: "package.cancelled",
        actorType: "system",
        afterJson: { reason: "refund_full", charge_id: "chg-1", provider_refund_id: "re_1" },
      }),
    );
  });

  it("(b) dois parciais que SOMAM o total = full → flip (comportamento NOVO)", async () => {
    // Cada evento parcial individual NÃO atingiria o total; a SOMA persistida
    // (>= total) agora flipa — bug latente pré-T5 (per-event isFullRefund).
    refundedCentsMock = 12050; // soma cumulativa == totalCents
    cancelledMock = true;
    vi.mocked(repo.getCustomerPackageByChargeId).mockResolvedValueOnce({
      id: "cp-1",
    } as unknown as Awaited<ReturnType<typeof repo.getCustomerPackageByChargeId>>);

    await applyChargeRefunded("org-1", baseChargeRow, {
      action: "charge.refund_recorded",
      actorType: "system",
      providerRefundId: "re_2",
    });

    expect(repo.markChargeRefunded).toHaveBeenCalledWith("org-1", "chg-1");
    expect(repo.markPaymentReversed).toHaveBeenCalledWith("org-1", "chg-1");
  });

  it("(c) parcial isolado (soma < total) → SEM flip", async () => {
    refundedCentsMock = 5000; // < totalCents 12050
    await applyChargeRefunded("org-1", baseChargeRow, {
      action: "charge.refund_recorded",
      actorType: "system",
      providerRefundId: "re_3",
    });
    expect(repo.markChargeRefunded).not.toHaveBeenCalled();
    expect(repo.markPaymentReversed).not.toHaveBeenCalled();
    expect(repo.cancelCustomerPackageByChargeId).not.toHaveBeenCalled();
  });
});
