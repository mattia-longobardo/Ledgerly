import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ACCOUNT_TYPES } from "@/modules/accounts/rules";
import { parseJsonPreservingNumbers } from "./client";
import {
  firstLinkWindows,
  mapWalletAccount,
  mapWalletBalance,
  mapWalletCategory,
  mapWalletRecord,
  MAX_WINDOW_DAYS,
  monthWindow,
  recentWindow,
  splitWindow,
  type WalletAccountPayload,
  walletAccountsPayloadSchema,
  walletAccountType,
  walletCategoriesPayloadSchema,
  walletAmountToCents,
  walletLabelNames,
  walletRecordDate,
  type WalletRecordPayload,
  walletRecordsPayloadSchema,
  windowDays,
} from "./mapping";

/**
 * Fixtures are read as text and parsed the way `client.ts` parses a response, so a number literal
 * reaches the mappers as the digits the file holds — the whole point of the pipeline under test.
 */
function fixture(name: string): unknown {
  return parseJsonPreservingNumbers(readFileSync(join(process.cwd(), "tests/fixtures/wallet", name), "utf8"));
}

function accountsFixture(): WalletAccountPayload[] {
  return walletAccountsPayloadSchema.parse(fixture("accounts.json"));
}

function recordsFixture(name: string): WalletRecordPayload[] {
  return walletRecordsPayloadSchema.parse(fixture(name)).records;
}

function byId<T extends { id: string }>(rows: readonly T[], id: string): T {
  const found = rows.find((row) => row.id === id);
  if (!found) throw new Error(`Fixture is missing "${id}"`);
  return found;
}

describe("walletAccountType", () => {
  it.each([
    [" Cash ", "cash"],
    ["general", "checking"],
    ["checking", "checking"],
    ["Current", "checking"],
    ["saving", "savings"],
    ["SAVINGS", "savings"],
    ["investment", "investment"],
    ["Credit Card", "credit"],
    ["crypto", "crypto"],
  ])("maps %s to %s", (accountType, expected) => {
    expect(walletAccountType({ accountType })).toBe(expected);
  });

  it("falls back to the investment flag only for a type it does not know", () => {
    expect(walletAccountType({ accountType: "brokerage account", isInvestmentAccount: true })).toBe(
      "investment",
    );
    expect(walletAccountType({ accountType: "brokerage account", isInvestmentAccount: false })).toBe("other");
    expect(walletAccountType({ isInvestmentAccount: true })).toBe("investment");
    expect(walletAccountType({})).toBe("other");
    expect(walletAccountType({ accountType: null, isInvestmentAccount: null })).toBe("other");
  });

  it("keeps a named type even when the investment flag is set", () => {
    expect(walletAccountType({ accountType: "cash", isInvestmentAccount: true })).toBe("cash");
  });

  it("only ever produces a local account type", () => {
    const produced = accountsFixture().map((raw) => walletAccountType(raw));
    for (const type of produced) expect(ACCOUNT_TYPES).toContain(type);
  });
});

describe("walletAmountToCents", () => {
  it.each([
    ["1234.56", 123456n],
    ["-8.615", -862n],
    ["1.005", 101n],
    ["0.1", 10n],
    ["1900", 190000n],
    ["+12.3", 1230n],
    [" 7.10 ", 710n],
  ])("reads the source text %s as cents", (text, expected) => {
    expect(walletAmountToCents(text)).toBe(expected);
  });

  it("converts a genuine JSON number through its fixed decimal representation", () => {
    expect(walletAmountToCents(0.1 + 0.2)).toBe(30n);
    expect(walletAmountToCents(2615.39)).toBe(261539n);
    expect(walletAmountToCents(-432.1)).toBe(-43210n);
  });

  it("routes exponent notation, which is legal JSON, through the same conversion", () => {
    expect(walletAmountToCents("1e3")).toBe(100000n);
    expect(walletAmountToCents("-1.5E2")).toBe(-15000n);
  });

  it.each(["", "   ", "abc", "1.234,56", "€1"])("rejects %s", (text) => {
    expect(() => walletAmountToCents(text)).toThrow(RangeError);
  });
});

describe("walletRecordDate", () => {
  it("takes the day from Wallet's own text, never from a Date", () => {
    expect(walletRecordDate("2026-01-05")).toBe("2026-01-05");
    expect(walletRecordDate("2026-01-20T23:40:00.000Z")).toBe("2026-01-20");
  });

  it.each(["", "05/01/2026", "2026-02-30", "2026-1-5"])("rejects %s", (raw) => {
    expect(() => walletRecordDate(raw)).toThrow(RangeError);
  });
});

describe("mapWalletAccount", () => {
  it("maps the whole synthetic page", () => {
    const accounts = accountsFixture().map(mapWalletAccount);
    expect(accounts.map((account) => [account.externalId, account.type])).toEqual([
      ["wa-cash", "cash"],
      ["wa-general", "checking"],
      ["wa-current", "checking"],
      ["wa-saving", "savings"],
      ["wa-savings", "savings"],
      ["wa-investment", "investment"],
      ["wa-credit", "credit"],
      ["wa-crypto", "crypto"],
      ["wa-brokerage", "investment"],
      ["wa-mystery", "other"],
    ]);
  });

  it("trims the name, upper-cases the currency and keeps an unparseable instant unknown", () => {
    expect(mapWalletAccount(byId(accountsFixture(), "wa-cash"))).toEqual({
      externalId: "wa-cash",
      name: "Contanti",
      type: "cash",
      currency: "EUR",
      archived: false,
      updatedAt: new Date("2026-03-14T08:30:00.000Z"),
    });
    expect(mapWalletAccount(byId(accountsFixture(), "wa-current")).currency).toBe("EUR");
    expect(mapWalletAccount(byId(accountsFixture(), "wa-mystery"))).toMatchObject({
      archived: true,
      updatedAt: null,
    });
  });
});

describe("mapWalletBalance", () => {
  it("converts every balance through its decimal text", () => {
    const balances = accountsFixture().map(mapWalletBalance);
    expect(balances.map((balance) => [balance.accountExternalId, balance.cents])).toEqual([
      ["wa-cash", 12840n],
      ["wa-general", 261539n],
      ["wa-current", 123456789n],
      // 1.005 * 100 is 100.49999999999999 as a double: half-up on the text is the only way to 101.
      ["wa-saving", 101n],
      ["wa-savings", 10n],
      ["wa-investment", 823107n],
      ["wa-credit", -43210n],
      ["wa-crypto", 9666n],
      ["wa-brokerage", 1500000n],
      ["wa-mystery", 0n],
    ]);
  });

  it("leaves the available figure unknown, because Wallet publishes none", () => {
    expect(
      accountsFixture()
        .map(mapWalletBalance)
        .every((balance) => balance.availableCents === null),
    ).toBe(true);
  });
});

describe("mapWalletRecord", () => {
  it("maps a dated expense, trimming text and de-duplicating labels", () => {
    const record = mapWalletRecord(byId(recordsFixture("records-january-first-half.json"), "wr-1001"));
    expect(record).toEqual({
      externalId: "wr-1001",
      accountExternalId: "wa-general",
      transferCounterExternalId: null,
      occurredOn: "2026-01-05",
      occurredAt: null,
      amountCents: -862n,
      currency: "EUR",
      payee: "Panificio Rossi",
      note: "pane e latte",
      categoryExternalId: "wc-groceries",
      categoryName: "Spesa",
      labels: ["spesa"],
      providerType: "expense",
      providerState: "cleared",
      updatedAt: new Date("2026-01-05T19:02:00.000Z"),
    });
  });

  /**
   * The currency of a movement is `amount.currencyCode` and there is no other: a record carries no
   * currency of its own, so a schema that demanded one at the top level refused *every* record.
   */
  it("takes the currency from inside the amount, and upper-cases it", () => {
    const records = recordsFixture("records-edge-cases.json");
    expect(mapWalletRecord(byId(records, "wr-4003")).currency).toBe("EUR");
    expect(mapWalletRecord(byId(records, "wr-4002")).currency).toBe("EUR");
  });

  /**
   * §4.3 through a nested amount. `1.0049999999` is the digits Wallet sent; as a double it becomes
   * `1.005` at six decimals and rounds up. The two answers differ, so this asserts which path the
   * value took rather than only that the result looks plausible — and the answer has to stay the
   * text's one now that the figure sits one object down.
   */
  it("reads a nested amount from its source text, not from a float", () => {
    const raw = byId(recordsFixture("records-edge-cases.json"), "wr-4002");
    expect(raw.amount.value).toBe("1.0049999999");
    expect(mapWalletRecord(raw).amountCents).toBe(100n);
    expect(walletAmountToCents(1.0049999999)).toBe(101n);
  });

  it("keeps the instant of a timestamped record next to its own day", () => {
    const record = mapWalletRecord(byId(recordsFixture("records-january-third-quarter.json"), "wr-1002"));
    expect(record.occurredOn).toBe("2026-01-20");
    expect(record.occurredAt).toEqual(new Date("2026-01-20T23:40:00.000Z"));
    expect(record.amountCents).toBe(190000n);
    expect(record.payee).toBe("Datore di lavoro");
    expect(record.categoryExternalId).toBeNull();
    expect(record.categoryName).toBeNull();
  });

  it("carries the category's own name, so nothing has to be looked up to adopt it", () => {
    const record = mapWalletRecord(byId(recordsFixture("records-edge-cases.json"), "wr-4003"));
    expect(record.categoryExternalId).toBe("wc-unsorted");
    // An id with no name is not a name: §9.1 adopts by name, and inventing one from the id would
    // create a category called "wc-unsorted".
    expect(record.categoryName).toBeNull();
  });

  it("carries the mirror record's id and never invents a payee", () => {
    const record = mapWalletRecord(byId(recordsFixture("records-january-fourth-quarter.json"), "wr-1003"));
    expect(record.transferCounterExternalId).toBe("wr-2003");
    expect(record.payee).toBeNull();
    expect(record.providerType).toBe("transfer");
    expect(record.amountCents).toBe(-25000n);
  });

  /**
   * The one place this file refuses to guess. §7.2 pairs transfers on the id of the opposite
   * *record*, which is `transfer.mirrorRecord`; `transfer.transferId` is a group id shared by both
   * legs. A block carrying only the group id therefore leaves the counterpart unknown — `null`,
   * never 0 and never the group id (§4.3) — and pairing such a leg needs a rule §7.2 does not have.
   */
  it("leaves the counterpart unknown when a transfer carries only its group id", () => {
    const raw = byId(recordsFixture("records-edge-cases.json"), "wr-4001");
    expect(raw.transfer).toMatchObject({ transferId: "wt-9002" });
    expect(raw.transfer?.mirrorRecord ?? null).toBeNull();
    expect(mapWalletRecord(raw).transferCounterExternalId).toBeNull();
  });

  it("has no counterpart at all for an ordinary movement", () => {
    const record = mapWalletRecord(byId(recordsFixture("records-january-third-quarter.json"), "wr-1002"));
    expect(record.transferCounterExternalId).toBeNull();
  });
});

/**
 * Labels, the one part of a record whose element shape is **not verified**: the array came back
 * empty in every record sampled with a real token, so both arms below are tolerance rather than
 * knowledge. What is asserted is the contract, not the guess — a label that cannot be read costs
 * that label and never the page.
 */
describe("walletLabelNames", () => {
  it("reads a bare string and an object with a name, and drops what it cannot read", () => {
    const record = mapWalletRecord(byId(recordsFixture("records-edge-cases.json"), "wr-4003"));
    expect(record.labels).toEqual(["casa", "spesa"]);
  });

  it("trims, de-duplicates and keeps Wallet's own order", () => {
    expect(walletLabelNames([" b ", "a", "b", { name: "a" }, ""])).toEqual(["b", "a"]);
    expect(walletLabelNames([])).toEqual([]);
    expect(walletLabelNames([null, true, 7, {}, { name: 7 }, []])).toEqual([]);
  });
});

describe("mapWalletCategory", () => {
  it("keeps the name §9.1 adopts by, and carries no flag Wallet does not publish", () => {
    const categories = walletCategoriesPayloadSchema.parse(fixture("categories.json")).map(mapWalletCategory);
    expect(categories).toEqual([
      { externalId: "wc-groceries", name: "Spesa", groupName: "Casa" },
      { externalId: "wc-salary", name: "Stipendio", groupName: null },
      { externalId: "wc-unsorted", name: "Da classificare", groupName: null },
    ]);
  });
});

describe("windowDays", () => {
  it("counts a closed window in days", () => {
    expect(windowDays({ from: "2026-01-05", to: "2026-01-05" })).toBe(0);
    expect(windowDays({ from: "2026-01-01", to: "2026-01-31" })).toBe(30);
    expect(windowDays({ from: "2028-02-01", to: "2028-02-29" })).toBe(28);
  });

  it.each([
    { from: "2026-01-31", to: "2026-01-01" },
    { from: "2026-01-01", to: "2026-02-30" },
    { from: "2020-01-01", to: "2026-01-01" },
  ])("rejects %o", (window) => {
    expect(() => windowDays(window)).toThrow(RangeError);
  });

  it("accepts a window exactly as wide as the cap", () => {
    expect(windowDays({ from: "2026-01-01", to: "2027-02-05" })).toBe(MAX_WINDOW_DAYS);
  });
});

describe("splitWindow", () => {
  it("halves a month into two disjoint windows that cover it", () => {
    expect(splitWindow({ from: "2026-01-01", to: "2026-01-31" })).toEqual([
      { from: "2026-01-01", to: "2026-01-16" },
      { from: "2026-01-17", to: "2026-01-31" },
    ]);
  });

  it("splits a two-day window into single days", () => {
    expect(splitWindow({ from: "2026-01-05", to: "2026-01-06" })).toEqual([
      { from: "2026-01-05", to: "2026-01-05" },
      { from: "2026-01-06", to: "2026-01-06" },
    ]);
  });

  it("cannot split a single day", () => {
    expect(splitWindow({ from: "2026-01-05", to: "2026-01-05" })).toBeNull();
  });

  it("keeps halving down to single days without ever losing or repeating one", () => {
    const start = { from: "2026-01-01", to: "2026-01-31" };
    const queue = [start];
    const days: string[] = [];
    while (queue.length > 0) {
      const window = queue.shift() as typeof start;
      const halves = splitWindow(window);
      if (halves === null) days.push(window.from);
      else queue.push(...halves);
    }
    expect(new Set(days).size).toBe(31);
    expect(days).toContain("2026-01-01");
    expect(days).toContain("2026-01-31");
  });
});

describe("firstLinkWindows", () => {
  it("builds twelve monthly windows ending with today's own month", () => {
    const windows = firstLinkWindows("2026-03-14");
    expect(windows).toHaveLength(12);
    expect(windows[0]).toEqual({ from: "2025-04-01", to: "2025-04-30" });
    expect(windows[11]).toEqual({ from: "2026-03-01", to: "2026-03-31" });
    for (const [index, window] of windows.entries()) {
      if (index === 0) continue;
      expect(window.from > windows[index - 1].to).toBe(true);
    }
  });

  it("gets February right in a leap year", () => {
    expect(firstLinkWindows("2028-02-15").at(-1)).toEqual({ from: "2028-02-01", to: "2028-02-29" });
    expect(monthWindow("2027-02-01")).toEqual({ from: "2027-02-01", to: "2027-02-28" });
  });

  it("takes a different month count, and rejects a nonsensical one", () => {
    expect(firstLinkWindows("2026-03-14", 1)).toEqual([{ from: "2026-03-01", to: "2026-03-31" }]);
    expect(() => firstLinkWindows("2026-03-14", 0)).toThrow(RangeError);
    expect(() => firstLinkWindows("14/03/2026")).toThrow(RangeError);
  });
});

describe("recentWindow", () => {
  it("covers exactly the last seven civil days, today included", () => {
    expect(recentWindow("2026-03-01")).toEqual({ from: "2026-02-23", to: "2026-03-01" });
    expect(windowDays(recentWindow("2026-03-01"))).toBe(6);
    expect(recentWindow("2026-03-01", 1)).toEqual({ from: "2026-03-01", to: "2026-03-01" });
  });

  it("rejects a day count or a date it cannot use", () => {
    expect(() => recentWindow("2026-03-01", 0)).toThrow(RangeError);
    expect(() => recentWindow("not-a-date")).toThrow(RangeError);
  });
});
