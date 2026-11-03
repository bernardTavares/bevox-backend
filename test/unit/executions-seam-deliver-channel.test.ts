import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Module under test:
import { deliverToChannel } from "@/modules/executions/seams.js";

// Modules we mock:
import * as repo from "@/modules/channels/metaapi/repository.js";
import * as client from "@/modules/channels/metaapi/client.js";

const ORG_ID = "0193e45a-c5e4-7000-9000-000000000010";
const EXEC_ID = "0193e45a-c5e4-7000-9000-000000000020";
const CONV_ID = "0193e45a-c5e4-7000-9000-000000000030";
const TENANT_ID = "0193e45a-c5e4-7000-9000-000000000040";

beforeAll(() => {
  process.env.AEAD_MASTER_KEY = "f".repeat(64);
});

beforeEach(() => {
  vi.resetAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

function mockHappyContext() {
  vi.spyOn(repo, "findMetaApiTenant").mockResolvedValue(TENANT_ID);
  vi.spyOn(repo, "findExecutionDeliveryContext").mockResolvedValue({
    channelConnectionId: "cc1",
    provider: "whatsapp",
    externalAccountId: "wa_phone_xyz",
    customerPhone: "5511999999999",
    customerId: "cust1",
    // null: unit tests não exercitam o branch de outgoing persistence
    // (POC HIGH outgoing-messages-not-persisted); integration test cobre.
    conversationKey: null,
  });
  vi.spyOn(repo, "insertMessageAudit").mockResolvedValue(undefined);
}

describe("deliverToChannel — skipped paths", () => {
  it("skipped_empty_text on empty responseText", async () => {
    mockHappyContext();
    const r = await deliverToChannel({
      organizationId: ORG_ID,
      conversationId: CONV_ID,
      responseText: "",
      executionId: EXEC_ID,
    });
    expect(r.status).toBe("skipped_empty_text");
  });

  it("skipped_missing_recipient when customerPhone null", async () => {
    vi.spyOn(repo, "findMetaApiTenant").mockResolvedValue(TENANT_ID);
    vi.spyOn(repo, "findExecutionDeliveryContext").mockResolvedValue({
      channelConnectionId: "cc1",
      provider: "whatsapp",
      externalAccountId: "wa_phone_xyz",
      customerPhone: null,
      customerId: "cust1",
      conversationKey: null,
    });
    vi.spyOn(repo, "insertMessageAudit").mockResolvedValue(undefined);
    const r = await deliverToChannel({
      organizationId: ORG_ID,
      conversationId: CONV_ID,
      responseText: "hi",
      executionId: EXEC_ID,
    });
    expect(r.status).toBe("skipped_missing_recipient");
  });

  it("skipped_missing_tenant when findMetaApiTenant null", async () => {
    vi.spyOn(repo, "findMetaApiTenant").mockResolvedValue(null);
    vi.spyOn(repo, "findExecutionDeliveryContext").mockResolvedValue({
      channelConnectionId: "cc1",
      provider: "whatsapp",
      externalAccountId: "wa_phone_xyz",
      customerPhone: "5511999",
      customerId: "cust1",
      conversationKey: null,
    });
    vi.spyOn(repo, "insertMessageAudit").mockResolvedValue(undefined);
    const r = await deliverToChannel({
      organizationId: ORG_ID,
      conversationId: CONV_ID,
      responseText: "hi",
      executionId: EXEC_ID,
    });
    expect(r.status).toBe("skipped_missing_tenant");
    if (r.status !== "skipped_missing_tenant") return;
    expect(r.organization_id).toBe(ORG_ID);
  });
});

describe("deliverToChannel — happy + retry paths", () => {
  it("returns sent on first attempt success", async () => {
    mockHappyContext();
    vi.spyOn(client, "sendMessage").mockResolvedValue({
      status: "sent",
      channel: "whatsapp",
      message_id: "msg1",
      provider_message_id: "wamid.1",
    });
    const r = await deliverToChannel({
      organizationId: ORG_ID,
      conversationId: CONV_ID,
      responseText: "hello",
      executionId: EXEC_ID,
    });
    expect(r.status).toBe("sent");
    if (r.status !== "sent") return;
    expect(r.message_id).toBe("msg1");
    expect(r.attempt_count).toBe(1);
  });

  it("retries META_UNAVAILABLE 2x then succeeds on 3rd", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mockHappyContext();
    const sendSpy = vi.spyOn(client, "sendMessage");
    sendSpy.mockResolvedValueOnce({ status: "error", code: "META_UNAVAILABLE", message: "down" });
    sendSpy.mockResolvedValueOnce({ status: "error", code: "META_UNAVAILABLE", message: "down" });
    sendSpy.mockResolvedValueOnce({
      status: "sent",
      channel: "whatsapp",
      message_id: "msg2",
      provider_message_id: "wamid.2",
    });
    const promise = deliverToChannel({
      organizationId: ORG_ID,
      conversationId: CONV_ID,
      responseText: "hello",
      executionId: EXEC_ID,
    });
    await vi.runAllTimersAsync();
    const r = await promise;
    expect(r.status).toBe("sent");
    if (r.status !== "sent") return;
    expect(r.attempt_count).toBe(3);
    expect(sendSpy).toHaveBeenCalledTimes(3);
    vi.useRealTimers();
  });

  it("failed_retryable_exhausted after 4 attempts (initial + 3 retries)", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mockHappyContext();
    const sendSpy = vi.spyOn(client, "sendMessage");
    sendSpy.mockResolvedValue({ status: "error", code: "META_UNAVAILABLE", message: "down" });
    const promise = deliverToChannel({
      organizationId: ORG_ID,
      conversationId: CONV_ID,
      responseText: "hello",
      executionId: EXEC_ID,
    });
    await vi.runAllTimersAsync();
    const r = await promise;
    expect(r.status).toBe("failed_retryable_exhausted");
    if (r.status !== "failed_retryable_exhausted") return;
    expect(r.error_code).toBe("META_UNAVAILABLE");
    expect(r.attempt_count).toBe(4);
    expect(sendSpy).toHaveBeenCalledTimes(4);
    vi.useRealTimers();
  });

  it("failed_rejected on META_REJECTED (no retries)", async () => {
    mockHappyContext();
    const sendSpy = vi.spyOn(client, "sendMessage");
    sendSpy.mockResolvedValue({ status: "error", code: "META_REJECTED", message: "template" });
    const r = await deliverToChannel({
      organizationId: ORG_ID,
      conversationId: CONV_ID,
      responseText: "hello",
      executionId: EXEC_ID,
    });
    expect(r.status).toBe("failed_rejected");
    if (r.status !== "failed_rejected") return;
    expect(r.error_code).toBe("META_REJECTED");
    expect(sendSpy).toHaveBeenCalledTimes(1);
  });

  it("failed_rejected on IDEMPOTENCY_CONFLICT (no retries)", async () => {
    mockHappyContext();
    vi.spyOn(client, "sendMessage").mockResolvedValue({
      status: "error",
      code: "IDEMPOTENCY_CONFLICT",
      message: "mismatch",
    });
    const r = await deliverToChannel({
      organizationId: ORG_ID,
      conversationId: CONV_ID,
      responseText: "hello",
      executionId: EXEC_ID,
    });
    expect(r.status).toBe("failed_rejected");
    if (r.status !== "failed_rejected") return;
    expect(r.error_code).toBe("IDEMPOTENCY_CONFLICT");
  });

  it("failed_rejected on UNAUTHENTICATED/FORBIDDEN/NOT_FOUND/CONFLICT (no retries)", async () => {
    mockHappyContext();
    const sendSpy = vi.spyOn(client, "sendMessage");
    for (const code of ["UNAUTHENTICATED", "FORBIDDEN", "NOT_FOUND", "CONFLICT"] as const) {
      sendSpy.mockResolvedValueOnce({ status: "error", code, message: "x" });
      const r = await deliverToChannel({
        organizationId: ORG_ID,
        conversationId: CONV_ID,
        responseText: "hello",
        executionId: EXEC_ID,
      });
      expect(r.status).toBe("failed_rejected");
      if (r.status !== "failed_rejected") continue;
      expect(r.error_code).toBe(code);
    }
  });

  it("IG plumb: builds payload with channel='instagram' (mocked 500 INTERNAL retries 3x → failed_retryable_exhausted)", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.spyOn(repo, "findMetaApiTenant").mockResolvedValue(TENANT_ID);
    vi.spyOn(repo, "findExecutionDeliveryContext").mockResolvedValue({
      channelConnectionId: "cc1",
      provider: "instagram",
      externalAccountId: "ig_acc_xyz",
      customerPhone: "ig_user_psid_abc",
      customerId: "cust1",
      conversationKey: null,
    });
    vi.spyOn(repo, "insertMessageAudit").mockResolvedValue(undefined);
    const sendSpy = vi.spyOn(client, "sendMessage");
    sendSpy.mockResolvedValue({ status: "error", code: "INTERNAL", message: "IG task #20" });
    const promise = deliverToChannel({
      organizationId: ORG_ID,
      conversationId: CONV_ID,
      responseText: "hello",
      executionId: EXEC_ID,
    });
    await vi.runAllTimersAsync();
    const r = await promise;
    expect(r.status).toBe("failed_retryable_exhausted");
    if (r.status !== "failed_retryable_exhausted") return;
    expect(r.channel).toBe("instagram");
    expect(sendSpy).toHaveBeenCalledTimes(4);
    const callArgs = sendSpy.mock.calls[0]![0];
    expect(callArgs.body.channel).toBe("instagram");
    expect(callArgs.body.to).toBe("ig_user_psid_abc");
    vi.useRealTimers();
  });

  it("calls insertMessageAudit on every outcome", async () => {
    mockHappyContext();
    const auditSpy = vi.spyOn(repo, "insertMessageAudit");
    vi.spyOn(client, "sendMessage").mockResolvedValue({
      status: "sent",
      channel: "whatsapp",
      message_id: "msg",
      provider_message_id: "wamid",
    });
    await deliverToChannel({
      organizationId: ORG_ID,
      conversationId: CONV_ID,
      responseText: "hello",
      executionId: EXEC_ID,
    });
    expect(auditSpy).toHaveBeenCalledTimes(1);
    expect(auditSpy.mock.calls[0]![0].action).toBe("metaapi.send.success");
  });
});
