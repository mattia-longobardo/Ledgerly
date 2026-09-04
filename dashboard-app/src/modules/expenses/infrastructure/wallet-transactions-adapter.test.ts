import { describe, expect, it } from "vitest";
import { mapWalletCategory, mapWalletRecord } from "./wallet-transactions-adapter";
import type { WalletCategory, WalletRecord } from "@/lib/clients/wallet";

describe("mapWalletCategory", () => {
  it("marks a category income when the provider flags it so", () => {
    const raw: WalletCategory = { id: "c1", name: "Interest, dividends", group: "Income", isIncome: true };
    expect(mapWalletCategory(raw)).toMatchObject({ externalId: "c1", name: "Interest, dividends", kind: "income" });
  });

  it("falls back to a name hint when the provider gives no explicit flag", () => {
    const raw: WalletCategory = { id: "c2", name: "Salary", group: null };
    expect(mapWalletCategory(raw).kind).toBe("income");
  });

  it("defaults to expense", () => {
    const raw: WalletCategory = { id: "c3", name: "Groceries", group: null };
    expect(mapWalletCategory(raw).kind).toBe("expense");
  });
});

describe("mapWalletRecord", () => {
  it("maps a plain expense", () => {
    const raw: WalletRecord = {
      id: "r1", accountId: "a1", amount: -12.5, currencyCode: "eur", categoryId: "c1",
      labels: ["work"], recordType: "expense", recordState: "cleared", note: "Coffee",
      recordDate: "2026-09-01T08:00:00Z", updatedAt: "2026-09-01T08:00:00Z",
    };
    expect(mapWalletRecord(raw)).toMatchObject({
      externalId: "r1", accountExternalId: "a1", amount: "-12.50", currency: "EUR",
      type: "expense", state: "cleared", note: "Coffee", labelExternalIds: ["work"], categoryExternalId: "c1",
    });
  });

  it("infers type from the amount sign when recordType is absent", () => {
    const raw: WalletRecord = { id: "r2", accountId: "a1", amount: 100, currencyCode: "EUR", labels: [], recordDate: "2026-09-01T00:00:00Z" };
    expect(mapWalletRecord(raw).type).toBe("income");
  });

  it("carries the transfer counter-record id through", () => {
    const raw: WalletRecord = { id: "r3", accountId: "a1", amount: -50, currencyCode: "EUR", labels: [], recordDate: "2026-09-01T00:00:00Z", transferCounterRecordId: "r4" };
    expect(mapWalletRecord(raw).externalTransferRef).toBe("r4");
  });
});
