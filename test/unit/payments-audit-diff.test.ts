import { describe, expect, it } from "vitest";
import { onboardingChanged } from "@/modules/payments/repository.js";

describe("onboardingChanged (audit gate — só audita transição real)", () => {
  it("status igual + booleans iguais → false (no-op, sem audit)", () => {
    expect(
      onboardingChanged(
        {
          onboarding_status: "verified",
          charges_enabled: true,
          payouts_enabled: false,
          details_submitted: true,
        },
        {
          onboarding_status: "verified",
          charges_enabled: true,
          payouts_enabled: false,
          details_submitted: true,
        },
      ),
    ).toBe(false);
  });
  it("status muda → true", () => {
    expect(
      onboardingChanged(
        {
          onboarding_status: "pending",
          charges_enabled: false,
          payouts_enabled: false,
          details_submitted: false,
        },
        {
          onboarding_status: "verified",
          charges_enabled: false,
          payouts_enabled: false,
          details_submitted: true,
        },
      ),
    ).toBe(true);
  });
  it("status igual mas boolean muda → true (diagnóstico mudou)", () => {
    expect(
      onboardingChanged(
        {
          onboarding_status: "verified",
          charges_enabled: false,
          payouts_enabled: false,
          details_submitted: true,
        },
        {
          onboarding_status: "verified",
          charges_enabled: true,
          payouts_enabled: false,
          details_submitted: true,
        },
      ),
    ).toBe(true);
  });
});
