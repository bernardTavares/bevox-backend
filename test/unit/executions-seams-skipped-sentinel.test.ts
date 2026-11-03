// M5-P2a Item 10 — SKIPPED audit sentinel test
//
// Verifica que skip paths em `deliverToChannel` gravam audit row com
// `errorCode: "SKIPPED"` (preservando `reason: <sub-kind>`). Forensic
// queries `WHERE error_code IS NOT NULL` agora capturam skipped events
// — fix da asymmetry SEV-L-1 do M5-P1.
//
// Cross-repo grep gate (spec §10 Risk-6): nenhum filter SQL
// `WHERE error_code = 'X'` estrito ou `WHERE error_code IS NOT NULL` foi
// encontrado em bevox-backend / bevox-meta-api que pudesse quebrar com
// o novo sentinel.

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { deliverToChannel } from "@/modules/executions/seams.js";
import * as repo from "@/modules/channels/metaapi/repository.js";

const ORG_ID = "0193e45a-c5e4-7000-9000-0000000000a0";
const EXEC_ID = "0193e45a-c5e4-7000-9000-0000000000a1";
const CONV_ID = "0193e45a-c5e4-7000-9000-0000000000a2";
const TENANT_ID = "0193e45a-c5e4-7000-9000-0000000000a3";

beforeAll(() => {
  process.env.AEAD_MASTER_KEY = "f".repeat(64);
});

beforeEach(() => {
  vi.resetAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("deliverToChannel — SKIPPED audit sentinel (Item 10)", () => {
  it("empty_text skip writes audit row with errorCode='SKIPPED' + reason='empty_text'", async () => {
    const auditSpy = vi.spyOn(repo, "insertMessageAudit").mockResolvedValue(undefined);
    vi.spyOn(repo, "findMetaApiTenant").mockResolvedValue(TENANT_ID);
    vi.spyOn(repo, "findExecutionDeliveryContext").mockResolvedValue({
      channelConnectionId: "cc1",
      provider: "whatsapp",
      externalAccountId: "wa_phone_xyz",
      customerPhone: "5511999999999",
      customerId: "cust1",
      conversationKey: null,
    });

    const r = await deliverToChannel({
      organizationId: ORG_ID,
      conversationId: CONV_ID,
      responseText: "   ",
      executionId: EXEC_ID,
    });

    expect(r.status).toBe("skipped_empty_text");
    expect(auditSpy).toHaveBeenCalledTimes(1);
    expect(auditSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "metaapi.send.skipped",
        errorCode: "SKIPPED",
        reason: "empty_text",
        attemptCount: 0,
      }),
    );
  });

  it("missing_recipient skip writes audit row with errorCode='SKIPPED' + reason='missing_recipient'", async () => {
    const auditSpy = vi.spyOn(repo, "insertMessageAudit").mockResolvedValue(undefined);
    vi.spyOn(repo, "findMetaApiTenant").mockResolvedValue(TENANT_ID);
    vi.spyOn(repo, "findExecutionDeliveryContext").mockResolvedValue({
      channelConnectionId: "cc1",
      provider: "whatsapp",
      externalAccountId: "wa_phone_xyz",
      customerPhone: null,
      customerId: "cust1",
      conversationKey: null,
    });

    const r = await deliverToChannel({
      organizationId: ORG_ID,
      conversationId: CONV_ID,
      responseText: "hello",
      executionId: EXEC_ID,
    });

    expect(r.status).toBe("skipped_missing_recipient");
    expect(auditSpy).toHaveBeenCalledTimes(1);
    expect(auditSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "metaapi.send.skipped",
        errorCode: "SKIPPED",
        reason: "missing_recipient",
        attemptCount: 0,
      }),
    );
  });

  it("missing_tenant skip writes audit row with errorCode='SKIPPED' + reason='missing_tenant'", async () => {
    const auditSpy = vi.spyOn(repo, "insertMessageAudit").mockResolvedValue(undefined);
    vi.spyOn(repo, "findMetaApiTenant").mockResolvedValue(null);
    vi.spyOn(repo, "findExecutionDeliveryContext").mockResolvedValue({
      channelConnectionId: "cc1",
      provider: "whatsapp",
      externalAccountId: "wa_phone_xyz",
      customerPhone: "5511999999999",
      customerId: "cust1",
      conversationKey: null,
    });

    const r = await deliverToChannel({
      organizationId: ORG_ID,
      conversationId: CONV_ID,
      responseText: "hello",
      executionId: EXEC_ID,
    });

    expect(r.status).toBe("skipped_missing_tenant");
    if (r.status !== "skipped_missing_tenant") return;
    expect(r.organization_id).toBe(ORG_ID);
    expect(auditSpy).toHaveBeenCalledTimes(1);
    expect(auditSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "metaapi.send.skipped",
        errorCode: "SKIPPED",
        reason: "missing_tenant",
        attemptCount: 0,
      }),
    );
  });
});
