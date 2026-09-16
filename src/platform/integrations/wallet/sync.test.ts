// The pure half of the sync engine: the bridge from Wallet's own shapes to the two modules'
// vocabularies. Everything else in `sync.ts` writes to the database and is covered by
// `sync.itest.ts` against a real Postgres (spec §11: no in-memory fakes).
import { describe, expect, it } from "vitest";
import { civilDateIn } from "@/platform/dates";
import type { WalletAccount, WalletTransaction } from "./client";
import {
  toIncomingTransaction,
  toRemoteAccount,
  walletTransactionState,
  walletTransactionType,
} from "./sync";

const ROME = "Europe/Rome";

function movement(over: Partial<WalletTransaction> = {}): WalletTransaction {
  return {
    externalId: "wr-1",
    accountExternalId: "wa-general",
    transferCounterExternalId: null,
    occurredOn: "2026-01-05",
    occurredAt: null,
    amountCents: -861n,
    currency: "EUR",
    payee: "Panificio Rossi",
    note: "pane e latte",
    categoryExternalId: "wc-groceries",
    labels: ["spesa"],
    providerType: "expense",
    providerState: "cleared",
    updatedAt: null,
    ...over,
  };
}

const CATEGORIES = new Map([["wc-groceries", "Spesa"]]);

describe("walletTransactionType", () => {
  it("keeps the type Wallet named", () => {
    expect(walletTransactionType({ providerType: "expense", amountCents: -100n })).toBe("expense");
    expect(walletTransactionType({ providerType: "income", amountCents: 100n })).toBe("income");
    expect(walletTransactionType({ providerType: "transfer", amountCents: -100n })).toBe("transfer");
  });

  it("accepts the synonyms Wallet also uses", () => {
    expect(walletTransactionType({ providerType: "withdrawal", amountCents: -100n })).toBe("expense");
    expect(walletTransactionType({ providerType: "deposit", amountCents: 100n })).toBe("income");
  });

  it("names a type Wallet did not by the sign of the amount", () => {
    expect(walletTransactionType({ providerType: null, amountCents: -100n })).toBe("expense");
    expect(walletTransactionType({ providerType: "sorcery", amountCents: 100n })).toBe("income");
  });

  it("keeps the provider's word over a sign that does not contradict it", () => {
    // A refunded expense is positive and still an expense to Wallet; `resolveType` (T3) has the
    // last word, and this function must not pre-empt it by guessing from the sign.
    expect(walletTransactionType({ providerType: "expense", amountCents: 100n })).toBe("expense");
  });
});

describe("walletTransactionState", () => {
  it("maps the states Wallet sends", () => {
    expect(walletTransactionState("cleared")).toBe("cleared");
    expect(walletTransactionState("reconciled")).toBe("cleared");
    expect(walletTransactionState("pending")).toBe("pending");
    expect(walletTransactionState("uncleared")).toBe("pending");
  });

  it("treats a state it does not know, and a missing one, as cleared", () => {
    expect(walletTransactionState("sorcery")).toBe("cleared");
    expect(walletTransactionState(null)).toBe("cleared");
  });
});

describe("toIncomingTransaction", () => {
  it("renames the transfer reference to the one the module pairs on", () => {
    const incoming = toIncomingTransaction(movement({ transferCounterExternalId: "wr-2" }), CATEGORIES, ROME);
    expect(incoming.counterpartExternalId).toBe("wr-2");
  });

  it("keeps the instant Wallet sent when it sent one", () => {
    const occurredAt = new Date("2026-01-05T18:02:00.000Z");
    expect(toIncomingTransaction(movement({ occurredAt }), CATEGORIES, ROME).occurredAt).toEqual(occurredAt);
  });

  it("stamps a bare day as midnight in the user's own zone", () => {
    const winter = toIncomingTransaction(movement({ occurredOn: "2026-01-05" }), CATEGORIES, ROME);
    expect(winter.occurredAt.toISOString()).toBe("2026-01-04T23:00:00.000Z");

    const summer = toIncomingTransaction(movement({ occurredOn: "2026-07-05" }), CATEGORIES, ROME);
    expect(summer.occurredAt.toISOString()).toBe("2026-07-04T22:00:00.000Z");
  });

  it("puts a bare day on that day in every zone, which is the whole point of the instant", () => {
    for (const timeZone of ["Europe/Rome", "UTC", "America/New_York", "Pacific/Apia"]) {
      const incoming = toIncomingTransaction(movement({ occurredOn: "2026-01-05" }), CATEGORIES, timeZone);
      expect(civilDateIn(incoming.occurredAt, timeZone)).toBe("2026-01-05");
    }
  });

  it("carries the category name the /categories read gave, and null for an id it did not", () => {
    expect(toIncomingTransaction(movement(), CATEGORIES, ROME).categoryName).toBe("Spesa");
    expect(
      toIncomingTransaction(movement({ categoryExternalId: "wc-unknown" }), CATEGORIES, ROME).categoryName,
    ).toBeNull();
    const none = toIncomingTransaction(movement({ categoryExternalId: null }), CATEGORIES, ROME);
    expect(none.categoryExternalId).toBeNull();
    expect(none.categoryName).toBeNull();
  });

  it("carries identity, money and taxonomy through unchanged", () => {
    const incoming = toIncomingTransaction(movement(), CATEGORIES, ROME);
    expect(incoming).toMatchObject({
      externalId: "wr-1",
      amountCents: -861n,
      currency: "EUR",
      type: "expense",
      state: "cleared",
      payee: "Panificio Rossi",
      note: "pane e latte",
      labels: ["spesa"],
    });
  });
});

describe("toRemoteAccount", () => {
  it("states the provider and its own id, which is what the lifecycle keys on", () => {
    const account: WalletAccount = {
      externalId: "wa-general",
      name: "Conto corrente",
      type: "checking",
      currency: "EUR",
      archived: false,
      updatedAt: null,
    };
    expect(toRemoteAccount(account)).toEqual({
      provider: "wallet",
      providerAccountId: "wa-general",
      name: "Conto corrente",
      type: "checking",
      currency: "EUR",
    });
  });
});
