import { beforeEach, describe, expect, it, vi } from "vitest";
import { postWalletInterestEntry } from "./wallet-interest-posting-adapter";
import type { InterestAccrual, InterestRule } from "../application/ports";
import type { FindPostedRecordOptions, PostRecordInput, WalletCallOptions, WalletRecord } from "@/lib/clients/wallet";

const postRecordsMock = vi.fn<(opts: WalletCallOptions, records: PostRecordInput[]) => Promise<WalletRecord[]>>();
const findPostedRecordMock = vi.fn<(opts: FindPostedRecordOptions) => Promise<WalletRecord | null>>();
const getCategoriesMock = vi.fn(async () => [{ id: "c1", name: "Interest, dividends", group: "Income" }]);

vi.mock("@/lib/clients/wallet", () => ({
  getCategories: (...args: unknown[]) => getCategoriesMock(...(args as [])),
  postRecords: (opts: WalletCallOptions, records: PostRecordInput[]) => postRecordsMock(opts, records),
  findPostedRecord: (opts: FindPostedRecordOptions) => findPostedRecordMock(opts),
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

function walletRecord(overrides: Partial<WalletRecord> = {}): WalletRecord {
  return {
    id: "created-1",
    accountId: "w1",
    amount: 0.05,
    currencyCode: "EUR",
    labels: [],
    recordDate: "2026-09-05T00:00:00Z",
    ...overrides,
  };
}

beforeEach(() => {
  postRecordsMock.mockReset();
  findPostedRecordMock.mockReset();
  getCategoriesMock.mockClear();
  findPostedRecordMock.mockResolvedValue(null);
  postRecordsMock.mockResolvedValue([walletRecord()]);
});

describe("postWalletInterestEntry", () => {
  it("posts against the resolved Wallet account id with the matched category, and a note built from the accrual's own figures", async () => {
    const result = await postWalletInterestEntry({ token: "t", walletAccountId: "w1", rule, accrual });
    // Built from `accrual.gross`/`accrual.tax`/`accrual.net`, not the rule's
    // current `annualRate`/`taxRate` — a rate edited after this accrual was
    // computed must not relabel this posted amount with the wrong figure.
    expect(result.note).toBe("auto-interest gross 0.06, tax 0.02, net 0.05 on 1000.00");
    expect(postRecordsMock).toHaveBeenCalledWith(
      { token: "t", attempts: 1 },
      [{ accountId: "w1", amount: 0.05, recordDate: "2026-09-05T00:00:00Z", note: result.note, categoryId: "c1" }],
    );
  });

  it("the note does not change when the rule's rate is edited after the accrual was computed", async () => {
    const editedRule = { ...rule, annualRate: "0.10", taxRate: "0.0" };
    const result = await postWalletInterestEntry({ token: "t", walletAccountId: "w1", rule: editedRule, accrual });
    expect(result.note).toBe("auto-interest gross 0.06, tax 0.02, net 0.05 on 1000.00");
  });

  it("posts uncategorised, not failing, when the named category is not found", async () => {
    const result = await postWalletInterestEntry({ token: "t", walletAccountId: "w1", rule: { ...rule, providerCategoryRef: "Nonexistent" }, accrual });
    expect(result.note).toBeTruthy();
    const [, records] = postRecordsMock.mock.calls.at(-1)!;
    expect(records[0]!.categoryId).toBeUndefined();
  });

  it("checks Wallet for an existing record before posting, with the same filter shape interest.py uses", async () => {
    await postWalletInterestEntry({ token: "t", walletAccountId: "w1", rule, accrual });
    expect(findPostedRecordMock).toHaveBeenCalledWith({
      token: "t",
      accountId: "w1",
      recordDate: "2026-09-05",
      noteContains: "auto-interest",
    });
  });

  it("returns the created record's id as transactionId on a fresh post", async () => {
    postRecordsMock.mockResolvedValueOnce([walletRecord({ id: "fresh-1" })]);
    const result = await postWalletInterestEntry({ token: "t", walletAccountId: "w1", rule, accrual });
    expect(result.transactionId).toBe("fresh-1");
  });

  it("skips posting entirely when Wallet already has a matching record — the crash-recovery path", async () => {
    findPostedRecordMock.mockResolvedValueOnce(walletRecord({ id: "already-there", note: "auto-interest existing note" }));

    const result = await postWalletInterestEntry({ token: "t", walletAccountId: "w1", rule, accrual });

    expect(result.transactionId).toBe("already-there");
    expect(result.note).toBe("auto-interest existing note");
    expect(getCategoriesMock).not.toHaveBeenCalled();
    expect(postRecordsMock).not.toHaveBeenCalled();
  });

  it("refuses a found record whose amount does not match this accrual's net, rather than marking this accrual posted against it", async () => {
    // Same account, same day, same default note marker — plausibly a
    // different rule's record, or a user's own record that happens to
    // contain "auto-interest". The amount is the only signal available to
    // tell them apart; a mismatch means this is not this accrual's record.
    findPostedRecordMock.mockResolvedValueOnce(walletRecord({ id: "someone-elses-record", amount: 9.99 }));

    await expect(postWalletInterestEntry({ token: "t", walletAccountId: "w1", rule, accrual })).rejects.toThrow(/does not match/);

    expect(postRecordsMock).not.toHaveBeenCalled();
  });
});
