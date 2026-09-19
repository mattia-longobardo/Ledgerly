// The pure half of the sync engine: the bridge from Wallet's own shapes to the two modules'
// vocabularies. Everything else in `sync.ts` writes to the database and is covered by
// `sync.itest.ts` against a real Postgres (spec §11: no in-memory fakes).
import { describe, expect, it } from "vitest";
import { civilDateIn } from "@/platform/dates";
import type { WalletAccount, WalletCategory, WalletTransaction } from "./client";
import {
  MAX_WINDOW_REMOVAL_SHARE,
  SyncBusyError,
  isSyncBusy,
  removalDoubt,
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
    categoryName: null,
    categoryGroupExternalId: null,
    categoryGroupName: null,
    categorySystemId: null,
    labels: ["spesa"],
    providerType: "expense",
    providerState: "cleared",
    updatedAt: null,
    ...over,
  };
}

const CATEGORIES = new Map<string, WalletCategory>([
  [
    "wc-groceries",
    {
      externalId: "wc-groceries",
      name: "Spesa",
      groupExternalId: "wcg-casa",
      groupName: "Casa",
      systemId: null,
    },
  ],
]);

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
  it("files a movement in Wallet's Transfer category as a giroconto, as Wallet counts it", () => {
    const transfer = { categorySystemId: "system_categories__transfer", providerType: "expense" };
    expect(toIncomingTransaction(movement(transfer), CATEGORIES, ROME).type).toBe("transfer");
    // From the category list when the record carries the id alone.
    const listed = new Map([
      [
        "wc-transfer",
        {
          externalId: "wc-transfer",
          name: "Trasferimento",
          groupExternalId: "system_categories",
          groupName: null,
          systemId: "system_categories__transfer",
        },
      ],
    ]);
    expect(toIncomingTransaction(movement({ categoryExternalId: "wc-transfer" }), listed, ROME).type).toBe(
      "transfer",
    );
    expect(toIncomingTransaction(movement(), CATEGORIES, ROME).type).toBe("expense");
  });

  it("renames the transfer reference to the one the module pairs on", () => {
    const incoming = toIncomingTransaction(movement({ transferCounterExternalId: "wr-2" }), CATEGORIES, ROME);
    expect(incoming.counterpartExternalId).toBe("wr-2");
  });

  it("keeps the instant Wallet sent when it agrees with the day Wallet stamped", () => {
    const occurredAt = new Date("2026-01-05T18:02:00.000Z");
    const incoming = toIncomingTransaction(movement({ occurredAt }), CATEGORIES, ROME);
    expect(incoming.occurredAt).toEqual(occurredAt);
    // 19:02 in Rome: the instant refines the day instead of moving it.
    expect(civilDateIn(incoming.occurredAt, ROME)).toBe("2026-01-05");
  });

  it("drops an instant that lands on another civil day east of Greenwich", () => {
    // Wallet stamped the 20th; 23:40 UTC is 00:40 on the 21st in Rome. Keeping the instant would
    // move the movement to another day, another month header, and out of Wallet's own window
    // filter — where it would be declared gone every hour (spec §7.2).
    const incoming = toIncomingTransaction(
      movement({ occurredOn: "2026-01-20", occurredAt: new Date("2026-01-20T23:40:00.000Z") }),
      CATEGORIES,
      ROME,
    );
    expect(incoming.occurredAt.toISOString()).toBe("2026-01-19T23:00:00.000Z");
    expect(civilDateIn(incoming.occurredAt, ROME)).toBe("2026-01-20");
  });

  it("drops an instant that lands on another civil day west of Greenwich", () => {
    // The same defect with the sign reversed: 02:00 UTC is still the 19th in New York.
    const incoming = toIncomingTransaction(
      movement({ occurredOn: "2026-01-20", occurredAt: new Date("2026-01-20T02:00:00.000Z") }),
      CATEGORIES,
      "America/New_York",
    );
    expect(incoming.occurredAt.toISOString()).toBe("2026-01-20T05:00:00.000Z");
    expect(civilDateIn(incoming.occurredAt, "America/New_York")).toBe("2026-01-20");
  });

  it("puts every movement on the day Wallet stamped it, whatever instant came with it", () => {
    // The invariant of `occurredAtOf`, as a property: the civil date the app reads back is always
    // `occurredOn`. Zones east and west of Greenwich, one half-hour offset, an ordinary day, both
    // of Rome's clock changes, and a bare day with no instant at all.
    const zones = ["Europe/Rome", "UTC", "America/New_York", "Pacific/Apia", "Asia/Kolkata"];
    const days = ["2026-01-20", "2026-03-29", "2026-07-01", "2026-10-25"];
    for (const timeZone of zones) {
      for (const occurredOn of days) {
        const bare = toIncomingTransaction(movement({ occurredOn, occurredAt: null }), CATEGORIES, timeZone);
        expect(civilDateIn(bare.occurredAt, timeZone)).toBe(occurredOn);
        for (let hour = 0; hour < 24; hour += 1) {
          const stamp = `${occurredOn}T${String(hour).padStart(2, "0")}:40:00.000Z`;
          const incoming = toIncomingTransaction(
            movement({ occurredOn, occurredAt: new Date(stamp) }),
            CATEGORIES,
            timeZone,
          );
          expect(civilDateIn(incoming.occurredAt, timeZone)).toBe(occurredOn);
        }
      }
    }
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
  });

  it("prefers the category name the record carries over the one /categories published", () => {
    // The record brings its own `category.name` (measured at the collaudo), which also covers a
    // category created between the two reads. An empty map proves the name did not come from it.
    const carried = movement({ categoryExternalId: "wc-new", categoryName: "Bollette" });
    expect(toIncomingTransaction(carried, new Map(), ROME).categoryName).toBe("Bollette");
    expect(toIncomingTransaction(carried, CATEGORIES, ROME).categoryName).toBe("Bollette");
    expect(
      toIncomingTransaction(movement({ categoryExternalId: "wc-unknown" }), CATEGORIES, ROME).categoryName,
    ).toBeNull();
    const none = toIncomingTransaction(movement({ categoryExternalId: null }), CATEGORIES, ROME);
    expect(none.categoryExternalId).toBeNull();
    expect(none.categoryName).toBeNull();
  });

  it("carries the category's group the way it carries its name: the record's, else the list's (F2.5)", () => {
    // The record says nothing about the category: the /categories list gives name and group.
    expect(toIncomingTransaction(movement(), CATEGORIES, ROME)).toMatchObject({
      categoryName: "Spesa",
      categoryGroupExternalId: "wcg-casa",
      categoryGroupName: "Casa",
    });
    // The record carries its category, with a group: that one wins.
    const regrouped = movement({
      categoryName: "Spesa",
      categoryGroupExternalId: "wcg-cibo",
      categoryGroupName: "Cibo",
    });
    expect(toIncomingTransaction(regrouped, CATEGORIES, ROME)).toMatchObject({
      categoryGroupExternalId: "wcg-cibo",
      categoryGroupName: "Cibo",
    });
    // The record carries its category and no group: it is fresher than the list, so no group.
    const ungrouped = movement({ categoryName: "Spesa" });
    expect(toIncomingTransaction(ungrouped, CATEGORIES, ROME)).toMatchObject({
      categoryGroupExternalId: null,
      categoryGroupName: null,
    });
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

describe("removalDoubt", () => {
  it("has nothing to doubt when the account has nothing stored in the window", () => {
    expect(removalDoubt(0, 0)).toBeNull();
    expect(removalDoubt(0, 5)).toBeNull();
  });

  it("refuses an empty answer for an account that has movements stored in the window", () => {
    // A 200 with no rows is indistinguishable from "I did not answer you", and it is the answer
    // that would hide a whole window in one pass.
    expect(removalDoubt(1, 0)).toBe("empty_answer");
    expect(removalDoubt(40, 0)).toBe("empty_answer");
  });

  it("refuses an answer that would remove more than the ceiling", () => {
    expect(removalDoubt(9, 2)).toBe("over_removal_ceiling");
    expect(removalDoubt(300, 100)).toBe("over_removal_ceiling");
  });

  it("allows a removal at the ceiling itself, and any smaller one", () => {
    expect(MAX_WINDOW_REMOVAL_SHARE).toBe(0.5);
    expect(removalDoubt(2, 1)).toBeNull();
    expect(removalDoubt(4, 2)).toBeNull();
    expect(removalDoubt(10, 9)).toBeNull();
  });

  it("doubts nothing when the answer brings at least as much as is stored", () => {
    expect(removalDoubt(3, 3)).toBeNull();
    expect(removalDoubt(3, 11)).toBeNull();
  });
});

describe("isSyncBusy", () => {
  it("recognises the lock's own refusal, and nothing else", () => {
    expect(isSyncBusy(new SyncBusyError())).toBe(true);
    expect(new SyncBusyError().code).toBe("busy");
    expect(isSyncBusy(new Error("busy"))).toBe(false);
    expect(isSyncBusy("busy")).toBe(false);
    expect(isSyncBusy(null)).toBe(false);
  });

  it("recognises it across two copies of the module, where `instanceof` cannot", () => {
    // What a Next.js build produces when a Server Action bundle and a job bundle each load this
    // module: the same class twice. The name is what survives.
    class SyncBusyError extends Error {
      readonly code = "busy";
      constructor() {
        super("a Wallet pass is already running on this connection");
        this.name = "SyncBusyError";
      }
    }
    expect(isSyncBusy(new SyncBusyError())).toBe(true);
  });
});
