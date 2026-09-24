import { describe, expect, it, vi } from "vitest";
import type { WalletRecordView } from "./client";
import type { WalletTransaction } from "./mapping";
import { WALLET_TRANSFER_CATEGORY } from "./mapping";

vi.mock("server-only", () => ({}));
vi.mock("@/modules/transactions/service", () => ({
  releaseLocalEdits: vi.fn(),
  upsertFromProvider: vi.fn(),
}));
vi.mock("@/modules/transactions/queries", () => ({ getTransaction: vi.fn() }));
vi.mock("../service", () => ({ externalIdsOf: vi.fn(), listConnections: vi.fn(), readCredentials: vi.fn() }));
vi.mock("./sync", () => ({ toIncomingTransaction: vi.fn() }));

const { WalletEditError, planWalletRecordEdit } = await import("./records");

function view(over: Partial<WalletTransaction> = {}, isTransfer = false): WalletRecordView {
  return {
    isTransfer,
    movement: {
      externalId: "wr-1",
      accountExternalId: "wa-1",
      transferCounterExternalId: null,
      occurredOn: "2026-09-20",
      occurredAt: null,
      amountCents: -4_250n,
      currency: "EUR",
      payee: "Bistro",
      note: "lunch",
      categoryExternalId: "c-food",
      categoryName: "Food",
      categoryGroupExternalId: null,
      categoryGroupName: null,
      categorySystemId: null,
      labels: [],
      providerType: "expense",
      providerState: "cleared",
      ...over,
    } as WalletTransaction,
  };
}

const same = { type: "expense" as const, amountCents: 4_250n, payee: "Bistro", note: "lunch" };

describe("planWalletRecordEdit", () => {
  it("sends nothing when the edit is what Wallet already holds", () => {
    expect(planWalletRecordEdit(view(), same, null)).toBeNull();
  });

  it("turns an expense into an income by the sign of the amount alone", () => {
    expect(planWalletRecordEdit(view(), { ...same, type: "income" }, null)).toEqual({
      id: "wr-1",
      amountCents: 4_250n,
    });
  });

  it("writes a new size with the sign the type decides, whatever sign was typed", () => {
    expect(planWalletRecordEdit(view(), { ...same, amountCents: -1_000n }, null)).toEqual({
      id: "wr-1",
      amountCents: -1_000n,
    });
  });

  it("clears an emptied note and payee instead of sending blanks", () => {
    expect(planWalletRecordEdit(view(), { ...same, note: "  ", payee: null }, null)).toEqual({
      id: "wr-1",
      clear: ["note", "counterParty"],
    });
  });

  it("makes a giroconto through Wallet's Transfer category, keeping the direction", () => {
    expect(planWalletRecordEdit(view(), { ...same, type: "transfer" }, "c-transfer")).toEqual({
      id: "wr-1",
      categoryId: "c-transfer",
    });
  });

  it("cannot make a giroconto without Wallet's Transfer category", () => {
    expect(() => planWalletRecordEdit(view(), { ...same, type: "transfer" }, null)).toThrow(WalletEditError);
  });

  it("undoes a transfer Wallet holds as one with $clear transfer", () => {
    expect(planWalletRecordEdit(view({}, true), same, null)).toEqual({ id: "wr-1", clear: ["transfer"] });
  });

  it("takes a record that is only in the Transfer category out of it", () => {
    const filed = view({ categorySystemId: WALLET_TRANSFER_CATEGORY });
    expect(planWalletRecordEdit(filed, { ...same, type: "income" }, null)).toEqual({
      id: "wr-1",
      amountCents: 4_250n,
      clear: ["categoryId"],
    });
  });

  it("refuses a zero amount before anything is sent", () => {
    expect(() => planWalletRecordEdit(view(), { ...same, amountCents: 0n }, null)).toThrow(WalletEditError);
  });
});
