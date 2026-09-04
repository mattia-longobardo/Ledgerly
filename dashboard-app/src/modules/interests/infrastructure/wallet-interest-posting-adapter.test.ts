import { describe, expect, it, vi } from "vitest";
import { postWalletInterestEntry } from "./wallet-interest-posting-adapter";
import type { InterestAccrual, InterestRule } from "../application/ports";
import type { PostRecordInput, WalletCallOptions } from "@/lib/clients/wallet";

const postRecordsMock = vi.fn<(opts: WalletCallOptions, records: PostRecordInput[]) => Promise<void>>();
vi.mock("@/lib/clients/wallet", () => ({
  getCategories: vi.fn(async () => [{ id: "c1", name: "Interest, dividends", group: "Income" }]),
  postRecords: (opts: WalletCallOptions, records: PostRecordInput[]) => postRecordsMock(opts, records),
}));

const rule: InterestRule = {
  id: "r1", userId: "u1", accountId: "acc-1", annualRate: "0.0225", taxRate: "0.26",
  dayCount: 365, compounding: "simple_daily", effectiveFrom: "2026-01-01", effectiveTo: null,
  postingMode: "post_to_provider", providerCategoryRef: null, noteMarker: "auto-interest",
  version: 1, createdAt: new Date(), updatedAt: new Date(),
};

const accrual: InterestAccrual = {
  id: "a1", ruleId: "r1", accrualDate: "2026-09-05", balanceBasis: "1000.00",
  gross: "0.061644", tax: "0.016027", net: "0.05", carryAfter: "-0.000617",
  source: "computed", postedAt: null, entryId: null,
};

describe("postWalletInterestEntry", () => {
  it("posts against the resolved Wallet account id with the matched category and the legacy note format", async () => {
    const result = await postWalletInterestEntry({ token: "t", walletAccountId: "w1", rule, accrual });
    expect(result.note).toContain("auto-interest 2.25%/y (net 1.67%, -26% tax) on 1000.00");
    expect(postRecordsMock).toHaveBeenCalledWith(
      { token: "t" },
      [{ accountId: "w1", amount: 0.05, recordDate: "2026-09-05T00:00:00Z", note: result.note, categoryId: "c1" }],
    );
  });

  it("posts uncategorised, not failing, when the named category is not found", async () => {
    const result = await postWalletInterestEntry({ token: "t", walletAccountId: "w1", rule: { ...rule, providerCategoryRef: "Nonexistent" }, accrual });
    expect(result.note).toBeTruthy();
    const [, records] = postRecordsMock.mock.calls.at(-1)!;
    expect(records[0]!.categoryId).toBeUndefined();
  });
});
