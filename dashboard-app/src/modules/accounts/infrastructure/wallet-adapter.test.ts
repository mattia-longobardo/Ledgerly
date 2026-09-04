import { describe, expect, it, vi } from "vitest";
import type { WalletAccount } from "@/lib/clients/wallet";
import { mapWalletAccount, prefetchedWalletSource, walletAccountsSource } from "./wallet-adapter";

vi.mock("@/lib/clients/wallet", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/clients/wallet")>();
  return { ...actual, getAccounts: vi.fn() };
});

const { getAccounts } = await import("@/lib/clients/wallet");

function raw(over: Partial<WalletAccount> = {}): WalletAccount {
  return {
    id: "w1",
    name: "ING - Salary",
    currencyCode: "EUR",
    archived: false,
    balance: { currentBalance: 251 },
    ...over,
  };
}

describe("mapWalletAccount", () => {
  it("maps identity, currency, balance and the passed-through as-of date", () => {
    const mapped = mapWalletAccount(
      raw({ accountType: "General", updatedAt: "2026-09-01T10:00:00.000Z" }),
      "2026-09-02",
    );

    expect(mapped).toEqual({
      externalId: "w1",
      name: "ING - Salary",
      type: "checking",
      currency: "EUR",
      archived: false,
      balance: "251.00",
      available: null,
      asOf: "2026-09-02",
      updatedAt: new Date("2026-09-01T10:00:00.000Z"),
    });
  });

  it.each([
    ["Cash", "cash"],
    ["General", "checking"],
    ["Checking", "checking"],
    ["Current", "checking"],
    ["Saving", "savings"],
    ["Savings", "savings"],
    ["Investment", "investment"],
    ["Credit Card", "credit"],
    ["Crypto", "crypto"],
    ["Loan", "other"],
  ])("maps the %s account type to %s", (accountType, expected) => {
    expect(mapWalletAccount(raw({ accountType }), "2026-09-02").type).toBe(expected);
  });

  it("treats a missing account type as other", () => {
    expect(mapWalletAccount(raw(), "2026-09-02").type).toBe("other");
  });

  it("falls back to investment when only the investment flag is set", () => {
    expect(mapWalletAccount(raw({ isInvestmentAccount: true }), "2026-09-02").type).toBe("investment");
  });

  it("carries the upstream archived flag", () => {
    expect(mapWalletAccount(raw({ archived: true }), "2026-09-02").archived).toBe(true);
  });

  it("renders every balance with two decimals", () => {
    expect(mapWalletAccount(raw({ balance: { currentBalance: 251 } }), "2026-09-02").balance).toBe("251.00");
    expect(mapWalletAccount(raw({ balance: { currentBalance: -0.5 } }), "2026-09-02").balance).toBe("-0.50");
    expect(mapWalletAccount(raw({ balance: { currentBalance: 1234.567 } }), "2026-09-02").balance).toBe("1234.57");
  });

  it("has no updated-at when the provider does not send one", () => {
    expect(mapWalletAccount(raw(), "2026-09-02").updatedAt).toBeNull();
  });
});

describe("walletAccountsSource", () => {
  it("fetches with the given token and maps every account", async () => {
    vi.mocked(getAccounts).mockResolvedValueOnce([raw()]);

    const source = walletAccountsSource({ now: () => new Date("2026-09-02T09:00:00Z") }, "test-token");
    const rows = await source.fetchAccounts();

    expect(getAccounts).toHaveBeenCalledWith({ token: "test-token" });
    expect(source.provider).toBe("wallet");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ externalId: "w1", balance: "251.00" });
  });
});

describe("prefetchedWalletSource", () => {
  it("names the provider and hands back exactly what it was given", async () => {
    const mapped = mapWalletAccount(raw(), "2026-09-02");
    const source = prefetchedWalletSource([mapped]);

    expect(source.provider).toBe("wallet");
    await expect(source.fetchAccounts()).resolves.toEqual([mapped]);
  });
});
