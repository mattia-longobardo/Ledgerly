import { describe, expect, it } from "vitest";
import { interestAccrualNotice } from "./interest-accrual-notice";

describe("admin settings page — interestAccrualNotice (C2)", () => {
  it("is silent when the last run's detail carries no skip or in-flight-post counts", () => {
    expect(interestAccrualNotice(null)).toBeNull();
    expect(interestAccrualNotice(undefined)).toBeNull();
    expect(interestAccrualNotice({ rulesConsidered: 3, accrued: 3, posted: 3, failed: 0, postFailed: 0, skipped: 0 })).toBeNull();
  });

  // Ruling P3-C44 (B6): a rule that skips by construction must not vanish
  // into a plain "success" badge on the one panel purpose-built to show a
  // job's health.
  it("surfaces a skip count from a run that otherwise reports success", () => {
    expect(
      interestAccrualNotice({ rulesConsidered: 4, accrued: 3, posted: 3, failed: 0, postFailed: 0, skipped: 1 }),
    ).toBe("1 rule skipped");
    expect(
      interestAccrualNotice({ rulesConsidered: 6, accrued: 3, posted: 3, failed: 0, postFailed: 0, skipped: 3 }),
    ).toBe("3 rules skipped");
  });

  // Ruling P3-C39 (B2): `postedAt` set with `entryId` still null — an
  // observable in-flight state an operator must reconcile — must be visible
  // here too, not only inside a specific rule's own reconciliation view.
  it("surfaces an in-flight/unconfirmed post count", () => {
    expect(
      interestAccrualNotice({ rulesConsidered: 2, accrued: 2, posted: 1, failed: 0, postFailed: 1, skipped: 0 }),
    ).toBe("1 post unconfirmed at Wallet");
  });

  it("joins both signals when a single run carries them together", () => {
    expect(
      interestAccrualNotice({ rulesConsidered: 5, accrued: 3, posted: 2, failed: 0, postFailed: 1, skipped: 2 }),
    ).toBe("2 rules skipped · 1 post unconfirmed at Wallet");
  });

  it("does not throw on a malformed or unexpected detail shape", () => {
    expect(interestAccrualNotice("not an object")).toBeNull();
    expect(interestAccrualNotice(42)).toBeNull();
    expect(interestAccrualNotice({ skipped: "two" })).toBeNull();
  });
});
