import { beforeEach, describe, expect, it, vi } from "vitest";
import { postWalletInterestEntry, WalletPostAmbiguousError } from "./wallet-interest-posting-adapter";
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
    // Built from `accrual.net`, not the rule's current `annualRate`/`taxRate`
    // — a rate edited after this accrual was computed must not relabel this
    // posted amount with the wrong figure. The marker carries the rule's id
    // suffix (Ruling P3-C41, B4).
    expect(result.note).toBe("auto-interest:r1 net 0.05 on 1000.00");
    // `recordDate` is the bare accrual date, not a midnight timestamp
    // (Ruling P3-C40, B1) — the same grain `findPostedRecord`'s
    // `recordDate=eq.<day>` filter queries. `amount` is a decimal string,
    // never a `Number()`-converted float (B8).
    expect(postRecordsMock).toHaveBeenCalledWith(
      { token: "t", attempts: 1 },
      [{ accountId: "w1", amount: "0.05", recordDate: "2026-09-05", note: result.note, categoryId: "c1" }],
    );
  });

  it("the note does not change when the rule's rate is edited after the accrual was computed", async () => {
    const editedRule = { ...rule, annualRate: "0.10", taxRate: "0.0" };
    const result = await postWalletInterestEntry({ token: "t", walletAccountId: "w1", rule: editedRule, accrual });
    expect(result.note).toBe("auto-interest:r1 net 0.05 on 1000.00");
  });

  it("posts uncategorised, not failing, when the named category is not found", async () => {
    const result = await postWalletInterestEntry({ token: "t", walletAccountId: "w1", rule: { ...rule, providerCategoryRef: "Nonexistent" }, accrual });
    expect(result.note).toBeTruthy();
    const [, records] = postRecordsMock.mock.calls.at(-1)!;
    expect(records[0]!.categoryId).toBeUndefined();
  });

  it("checks Wallet for an existing record before posting, scoped by the rule's own suffixed marker (Ruling P3-C41)", async () => {
    await postWalletInterestEntry({ token: "t", walletAccountId: "w1", rule, accrual });
    expect(findPostedRecordMock).toHaveBeenCalledWith({
      token: "t",
      accountId: "w1",
      recordDate: "2026-09-05",
      noteContains: "auto-interest:r1",
    });
  });

  it("two rules sharing the same base noteMarker on the same account/day get distinct, non-colliding scoped markers", async () => {
    const otherRule = { ...rule, id: "r2" };
    await postWalletInterestEntry({ token: "t", walletAccountId: "w1", rule, accrual });
    await postWalletInterestEntry({ token: "t", walletAccountId: "w1", rule: otherRule, accrual: { ...accrual, id: "a2" } });
    const markers = findPostedRecordMock.mock.calls.map(([opts]) => opts.noteContains);
    expect(markers).toEqual(["auto-interest:r1", "auto-interest:r2"]);
    expect(new Set(markers).size).toBe(2);
  });

  it("returns the created record's id as transactionId on a fresh post", async () => {
    postRecordsMock.mockResolvedValueOnce([walletRecord({ id: "fresh-1" })]);
    const result = await postWalletInterestEntry({ token: "t", walletAccountId: "w1", rule, accrual });
    expect(result.transactionId).toBe("fresh-1");
  });

  it("skips posting entirely when Wallet already has a matching record — the crash-recovery path", async () => {
    findPostedRecordMock.mockResolvedValueOnce(walletRecord({ id: "already-there", note: "auto-interest:r1 existing note" }));

    const result = await postWalletInterestEntry({ token: "t", walletAccountId: "w1", rule, accrual });

    expect(result.transactionId).toBe("already-there");
    expect(result.note).toBe("auto-interest:r1 existing note");
    expect(getCategoriesMock).not.toHaveBeenCalled();
    expect(postRecordsMock).not.toHaveBeenCalled();
  });

  it("refuses a found record whose amount does not match this accrual's net, rather than marking this accrual posted against it", async () => {
    // Same account, same day, same scoped marker — plausibly a user's own
    // record that happens to contain it. The amount is the only signal
    // available to tell them apart; a mismatch means this is not this
    // accrual's record. This failure happens before any write is attempted,
    // so it is a plain Error, not a WalletPostAmbiguousError.
    findPostedRecordMock.mockResolvedValueOnce(walletRecord({ id: "someone-elses-record", amount: 9.99 }));

    await expect(postWalletInterestEntry({ token: "t", walletAccountId: "w1", rule, accrual })).rejects.toThrow(/does not match/);

    expect(postRecordsMock).not.toHaveBeenCalled();
  });

  it("wraps a postRecords failure as WalletPostAmbiguousError — the write itself may or may not have landed", async () => {
    postRecordsMock.mockRejectedValueOnce(new Error("ECONNRESET"));
    await expect(postWalletInterestEntry({ token: "t", walletAccountId: "w1", rule, accrual })).rejects.toThrow(
      WalletPostAmbiguousError,
    );
  });

  it("does not wrap a findPostedRecord (read) failure as WalletPostAmbiguousError — no write was ever attempted", async () => {
    findPostedRecordMock.mockRejectedValueOnce(new Error("network blip"));
    const err = await postWalletInterestEntry({ token: "t", walletAccountId: "w1", rule, accrual }).catch((e: unknown) => e);
    expect(err).not.toBeInstanceOf(WalletPostAmbiguousError);
    expect(postRecordsMock).not.toHaveBeenCalled();
  });

  it("does not wrap a getCategories (read) failure as WalletPostAmbiguousError — no write was ever attempted", async () => {
    getCategoriesMock.mockRejectedValueOnce(new Error("network blip"));
    const err = await postWalletInterestEntry({ token: "t", walletAccountId: "w1", rule, accrual }).catch((e: unknown) => e);
    expect(err).not.toBeInstanceOf(WalletPostAmbiguousError);
    expect(postRecordsMock).not.toHaveBeenCalled();
  });
});
