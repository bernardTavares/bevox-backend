import { describe, expect, it } from "vitest";
import { deriveOnboardingStatus, type StripeAccountish } from "@/modules/payments/status.js";

function acct(p: Partial<StripeAccountish>): StripeAccountish {
  return {
    charges_enabled: p.charges_enabled ?? false,
    payouts_enabled: p.payouts_enabled ?? false,
    details_submitted: p.details_submitted ?? false,
    requirements: p.requirements ?? null,
  };
}

describe("deriveOnboardingStatus", () => {
  it("disabled_reason truthy → restricted (highest precedence, even if charges+payouts)", () => {
    expect(
      deriveOnboardingStatus(
        acct({
          charges_enabled: true,
          payouts_enabled: true,
          details_submitted: true,
          requirements: { disabled_reason: "requirements.past_due" },
        }),
      ),
    ).toBe("restricted");
  });

  it("charges_enabled AND payouts_enabled (no disabled_reason) → active", () => {
    expect(
      deriveOnboardingStatus(
        acct({ charges_enabled: true, payouts_enabled: true, details_submitted: true }),
      ),
    ).toBe("active");
  });

  it("charges_enabled but NOT payouts_enabled → verified (cannot receive yet)", () => {
    expect(
      deriveOnboardingStatus(
        acct({ charges_enabled: true, payouts_enabled: false, details_submitted: true }),
      ),
    ).toBe("verified");
  });

  it("details_submitted only (no charges/payouts) → verified", () => {
    expect(deriveOnboardingStatus(acct({ details_submitted: true }))).toBe("verified");
  });

  it("currently_due/past_due set but no disabled_reason, details_submitted → verified (V1 simplification)", () => {
    expect(
      deriveOnboardingStatus(
        acct({
          details_submitted: true,
          requirements: { disabled_reason: null, currently_due: ["external_account"] },
        }),
      ),
    ).toBe("verified");
  });

  it("nothing submitted → pending", () => {
    expect(deriveOnboardingStatus(acct({}))).toBe("pending");
  });

  it("requirements null → treated as no disabled_reason", () => {
    expect(
      deriveOnboardingStatus(
        acct({ charges_enabled: true, payouts_enabled: true, requirements: null }),
      ),
    ).toBe("active");
  });

  it("active (charges∧payouts) precede verified mesmo com details_submitted=false", () => {
    expect(
      deriveOnboardingStatus(
        acct({ charges_enabled: true, payouts_enabled: true, details_submitted: false }),
      ),
    ).toBe("active");
  });
});
