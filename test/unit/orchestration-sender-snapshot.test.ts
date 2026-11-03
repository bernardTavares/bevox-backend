import { describe, expect, it } from "vitest";

import { parseSenderSnapshot } from "@/modules/orchestration/repository.js";

describe("parseSenderSnapshot — WhatsApp shape (contacts[0])", () => {
  it("extrai wa_id como contactId + phoneNumber com prefixo +", () => {
    const r = parseSenderSnapshot({
      wa_id: "5511999999999",
      profile: { name: "João" },
    });
    expect(r).toEqual({
      contactId: "5511999999999",
      phoneNumber: "+5511999999999",
      displayName: "João",
    });
  });

  it("preserva + se já estiver presente (não duplica)", () => {
    const r = parseSenderSnapshot({ wa_id: "+5511999999999" });
    expect(r?.phoneNumber).toBe("+5511999999999");
  });

  it("displayName=null quando profile.name ausente", () => {
    const r = parseSenderSnapshot({ wa_id: "5511999999999" });
    expect(r?.displayName).toBeNull();
  });

  it("displayName=null quando profile presente mas name ausente", () => {
    const r = parseSenderSnapshot({ wa_id: "5511999999999", profile: {} });
    expect(r?.displayName).toBeNull();
  });
});

describe("parseSenderSnapshot — Instagram shape (sender)", () => {
  it("extrai sender.id como contactId, phoneNumber=null", () => {
    const r = parseSenderSnapshot({ id: "1234567890" });
    expect(r).toEqual({
      contactId: "1234567890",
      phoneNumber: null,
      displayName: null,
    });
  });

  it("ignora wa_id quando ausente e usa id", () => {
    const r = parseSenderSnapshot({ id: "psid_x" });
    expect(r?.contactId).toBe("psid_x");
  });

  it("WA tem prioridade sobre IG se ambos presentes (compatibilidade)", () => {
    const r = parseSenderSnapshot({ wa_id: "5511999999999", id: "psid" });
    expect(r?.contactId).toBe("5511999999999");
    expect(r?.phoneNumber).toBe("+5511999999999");
  });
});

describe("parseSenderSnapshot — degraded paths", () => {
  it("null snapshot → null", () => {
    expect(parseSenderSnapshot(null)).toBeNull();
  });

  it("undefined → null", () => {
    expect(parseSenderSnapshot(undefined)).toBeNull();
  });

  it("snapshot sem wa_id nem id → null", () => {
    expect(parseSenderSnapshot({ profile: { name: "X" } })).toBeNull();
  });

  it("wa_id não-string → null (defensivo)", () => {
    expect(parseSenderSnapshot({ wa_id: 5511999999999 as unknown as string })).toBeNull();
  });
});
