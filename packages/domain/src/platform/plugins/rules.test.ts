import { describe, expect, it } from "vitest";
import type { PluginAccount, SyncResponse } from "@plugin-contract/calls";
import {
  accountSource,
  bankAccountNames,
  bankAccountType,
  hashState,
  instanceKeyOf,
  institutionOf,
  isReturnError,
  looksLikePrivateKey,
  maskIdentifier,
  measureReading,
  movementIds,
  normalizePrivateKey,
  pickBalance,
  pluginKinds,
  pluginLifecycle,
  pluginWrites,
  providerAccountIdOf,
  userPluginState,
} from "./rules";

describe("the state of a plugin for one person", () => {
  it("is available until it is turned on, and again when turned off with nothing saved", () => {
    expect(userPluginState({ active: false, hasCredentials: false, connections: 0 })).toBe("available");
  });

  it("is active when on, with or without credentials", () => {
    expect(userPluginState({ active: true, hasCredentials: false, connections: 0 })).toBe("active");
    expect(userPluginState({ active: true, hasCredentials: true, connections: 1 })).toBe("active");
  });

  it("is paused when turned off with credentials or connections still saved", () => {
    expect(userPluginState({ active: false, hasCredentials: true, connections: 0 })).toBe("paused");
    expect(userPluginState({ active: false, hasCredentials: false, connections: 1 })).toBe("paused");
  });
});

describe("the state of an access", () => {
  it("is kept as a hash that says nothing of the state", () => {
    expect(hashState("abc")).toMatch(/^[0-9a-f]{64}$/);
    expect(hashState("abc")).toBe(hashState("abc"));
    expect(hashState("abc")).not.toBe(hashState("abd"));
  });
});

describe("the key of a bank's connection", () => {
  it("goes there and back, with a colon in the name", () => {
    const institution = { name: "Banca: Uno", country: "IT" };
    expect(instanceKeyOf(institution)).toBe("IT:Banca: Uno");
    expect(institutionOf("IT:Banca: Uno")).toEqual(institution);
  });
});

describe("an account number on a screen", () => {
  it("shows the country, two digits and the last four", () => {
    expect(maskIdentifier("IT60 X054 2811 1010 0000 0123 456")).toBe("IT60 •••• 3456");
    expect(maskIdentifier("1234")).toBe("••••");
    expect(maskIdentifier(null)).toBeNull();
  });
});

describe("the identity of a movement", () => {
  const movement = {
    accountExternalId: "u-1",
    externalId: "ref-1" as string | null,
    status: "booked" as "booked" | "pending",
    bookingDate: "2026-01-10" as string | null,
    valueDate: "2026-01-10" as string | null,
    amount: "2.50",
    direction: "debit" as const,
    currency: "EUR",
    text: ["Bar  Centrale"],
    counterparty: "Bar Centrale" as string | null,
    merchantCategoryCode: null,
    bankTransactionCode: null,
  };
  const ids = (key: string, list: (typeof movement)[]) => movementIds(key, list).map((one) => one.externalId);

  it("is the bank's reference, under the account", () => {
    const [id] = ids("account-a", [movement]);
    expect(id).toMatch(/^[0-9a-f]{16}:ref-1$/);
    expect(ids("account-b", [movement])[0]).not.toBe(id);
    expect(ids("account-a", [movement])[0]).toBe(id);
  });

  it("is a hash when the bank gives no reference: the same at every reading, different for a different fact", () => {
    const bare = { ...movement, externalId: null };
    const [id] = ids("account-a", [bare]);
    expect(id).toMatch(/^[0-9a-f]{16}:x:[0-9a-f]{40}$/);
    expect(ids("account-a", [{ ...bare, text: ["BAR centrale"], counterparty: "bar  CENTRALE" }])[0]).toBe(
      id,
    );
    for (const other of [
      { amount: "2.51" },
      { bookingDate: "2026-01-11" },
      { direction: "credit" as const },
      { counterparty: "Bar Sport" },
    ]) {
      expect(ids("account-a", [{ ...bare, ...other } as typeof movement])[0]).not.toBe(id);
    }
  });

  it("tells two equal movements of the same day apart, by their order", () => {
    const bare = { ...movement, externalId: null };
    const twice = ids("account-a", [bare, bare, bare]);
    expect(new Set(twice).size).toBe(3);
    expect(ids("account-a", [bare, bare, bare])).toEqual(twice);
    expect(ids("account-a", [bare])[0]).toBe(twice[0]);
  });

  it("leaves a pending movement out, and counts a repeated reference once", () => {
    expect(ids("account-a", [{ ...movement, status: "pending" }])).toEqual([]);
    expect(ids("account-a", [movement, { ...movement, amount: "9.00" }])).toHaveLength(1);
  });

  it("keeps a very long reference inside the room of an id", () => {
    const [id] = ids("account-a", [{ ...movement, externalId: "r".repeat(200) }]);
    expect(id.length).toBeLessThanOrEqual(200);
    expect(id).toMatch(/:h:[0-9a-f]{40}$/);
  });
});

describe("the balance of an account", () => {
  it("is the booked one when the bank gives it, the available one otherwise", () => {
    expect(pickBalance([{ type: "ITAV" }, { type: "CLBD" }, { type: "XPCD" }])?.type).toBe("CLBD");
    expect(pickBalance([{ type: "ITAV" }])?.type).toBe("ITAV");
    expect(pickBalance([{ type: "SOMETHING" }, { type: "OTHR" }])?.type).toBe("OTHR");
    expect(pickBalance([])).toBeNull();
  });
});

describe("the id of a bank's account", () => {
  it("is the one that survives a new access, when the bank has one", () => {
    expect(providerAccountIdOf({ externalId: "u-1", stableId: "h-1" })).toBe("h-1");
    expect(providerAccountIdOf({ externalId: "u-1", stableId: null })).toBe("u-1");
  });
});

describe("the errors of a return", () => {
  it("are a closed list", () => {
    expect(isReturnError("denied")).toBe(true);
    expect(isReturnError("anything")).toBe(false);
    expect(isReturnError(null)).toBe(false);
  });
});

describe("a private key", () => {
  it("is recognised by its frame and sealed with one kind of line end", () => {
    const pem = "-----BEGIN PRIVATE KEY-----\r\nAAAA\r\n-----END PRIVATE KEY-----";
    expect(looksLikePrivateKey(pem)).toBe(true);
    expect(looksLikePrivateKey("AAAA")).toBe(false);
    expect(normalizePrivateKey(`  ${pem}  `)).toBe(
      "-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----\n",
    );
  });
});

describe("the measures of a first reading", () => {
  const accounts: PluginAccount[] = [
    {
      externalId: "u-1",
      stableId: "h-1",
      name: "Conto",
      identifier: "IT60X0542811101000000123456",
      currency: "EUR",
      kind: "CACC",
    },
    { externalId: "u-2", stableId: null, name: null, identifier: null, currency: "EUR", kind: null },
  ];
  const transaction = {
    accountExternalId: "u-1",
    externalId: "ref-1" as string | null,
    status: "booked" as const,
    bookingDate: "2026-01-10" as string | null,
    valueDate: "2026-01-11" as string | null,
    amount: "12.30",
    direction: "debit" as const,
    currency: "EUR",
    text: ["PAGAMENTO POS", "NEGOZIO"],
    counterparty: "Negozio" as string | null,
    merchantCategoryCode: "5411" as string | null,
    bankTransactionCode: null as string | null,
  };
  const batches: SyncResponse[] = [
    {
      accounts: [
        {
          externalId: "u-1",
          balances: [{ type: "CLBD", amount: "1.00", currency: "EUR", date: null }],
          error: null,
        },
        { externalId: "u-2", balances: [], error: "rate_limited" },
      ],
      transactions: [
        transaction,
        { ...transaction, externalId: "ref-1" },
        {
          ...transaction,
          externalId: null,
          status: "pending",
          bookingDate: null,
          text: [],
          counterparty: null,
        },
      ],
      cursor: "x",
      coverage: { from: null, to: null },
    },
    {
      accounts: [],
      transactions: [{ ...transaction, externalId: "ref-2", bookingDate: "2025-01-10", text: ["UNA RIGA"] }],
      cursor: null,
      coverage: { from: null, to: null },
    },
  ];

  it("counts what the bank exposes", () => {
    expect(measureReading(accounts, batches, "2026-01-20")).toEqual({
      accounts: 2,
      accountKindCACC: 1,
      accountKindnone: 1,
      accountsWithIdentifier: 1,
      accountsWithStableId: 1,
      accountsWithName: 1,
      calls: 2,
      accountErrors: 1,
      balanceCLBD: 1,
      transactions: 4,
      booked: 3,
      pending: 1,
      withExternalId: 3,
      distinctExternalIds: 2,
      withoutBookingDate: 1,
      withValueDate: 4,
      withCounterparty: 3,
      withMerchantCode: 4,
      textLines0: 1,
      textLines1: 1,
      textLinesMore: 2,
      textAverageLength: 13,
      textMaxLength: 21,
      oldestBooking: 20250110,
      newestBooking: 20260110,
      historyDays: 375,
    });
  });

  it("carries numbers only: no name, no account number, no amount, no text", () => {
    const text = JSON.stringify(measureReading(accounts, batches, "2026-01-20"));
    for (const secret of ["Conto", "IT60", "12.30", "PAGAMENTO", "Negozio", "ref-1", "u-1"]) {
      expect(text).not.toContain(secret);
    }
  });
});

describe("the name of a bank's account", () => {
  const label = (type: string) =>
    ({ checking: "Conto", savings: "Risparmio", credit: "Carta", cash: "Contanti" })[type] ?? type;
  const account = (providerAccountId: string, name: string | null, kind: string | null) => ({
    providerAccountId,
    name,
    kind,
  });

  it("is the bank's name of the product", () => {
    const names = bankAccountNames([account("a", "Conto Arancio", "CACC")], "Zeta Bank", label);
    expect(names.get("a")).toBe("Conto Arancio");
  });

  it("is «bank kind» when the bank gives no name, with a number from the second of a kind", () => {
    const names = bankAccountNames(
      [account("a", null, "CACC"), account("b", " ", "SVGS"), account("c", null, "SVGS")],
      "Zeta Bank",
      label,
    );
    expect([...names.values()]).toEqual(["Zeta Bank Conto", "Zeta Bank Risparmio", "Zeta Bank Risparmio 2"]);
  });

  it("does not take a name that several accounts share: it is the holder's, not the account's", () => {
    const names = bankAccountNames(
      [
        account("a", "Anna Bianchi", "CACC"),
        account("b", "Anna Bianchi", "SVGS"),
        account("c", "Pocket", "SVGS"),
      ],
      "Zeta Bank",
      label,
    );
    expect([...names.values()]).toEqual(["Zeta Bank Conto", "Zeta Bank Risparmio", "Pocket"]);
  });

  it("is never longer than an account's name may be", () => {
    const names = bankAccountNames([account("a", "n".repeat(200), null)], "Zeta Bank", label);
    expect(names.get("a")).toHaveLength(80);
  });

  it("turns the bank's kind into the kind of account here", () => {
    expect(["SVGS", "CARD", "CASH", "CACC", null].map(bankAccountType)).toEqual([
      "savings",
      "credit",
      "cash",
      "checking",
      "checking",
    ]);
  });
});

describe("what a plugin reads", () => {
  it("is the days off for a calendar, the accounts then the movements for the others", () => {
    expect(pluginKinds("calendar")).toEqual(["leave"]);
    expect(pluginKinds("bank")).toEqual(["accounts", "transactions"]);
    expect(pluginKinds("source")).toEqual(["accounts", "transactions"]);
  });
});

describe("the five states of a plugin for one person (H56)", () => {
  const NONE = { accounts: 0, categories: 0, pendingTx: 0, pendingDays: 0 };
  const state = (facts: Partial<Parameters<typeof pluginLifecycle>[0]>) =>
    pluginLifecycle({ active: false, connections: 0, hasCredentials: false, leftovers: NONE, ...facts });

  it("is not active when off with nothing left", () => {
    expect(state({})).toBe("not_active");
  });

  it("is not connected when on with nothing yet", () => {
    expect(state({ active: true })).toBe("not_connected");
    expect(state({ active: true, hasCredentials: true, leftovers: { ...NONE, categories: 2 } })).toBe(
      "not_connected",
    );
  });

  it("is connected when on with a connection", () => {
    expect(state({ active: true, connections: 2, leftovers: { ...NONE, accounts: 3 } })).toBe("connected");
  });

  it("is disconnected when on with the accounts its «Disconnect» kept", () => {
    expect(state({ active: true, leftovers: { ...NONE, accounts: 1 } })).toBe("disconnected");
  });

  it.each<[string, Partial<Parameters<typeof pluginLifecycle>[0]>]>([
    ["accounts", { leftovers: { ...NONE, accounts: 3 } }],
    ["categories", { leftovers: { ...NONE, categories: 9 } }],
    ["movements to send", { leftovers: { ...NONE, pendingTx: 1 } }],
    ["days to send", { leftovers: { ...NONE, pendingDays: 17 } }],
    ["a connection kept from before H55", { connections: 1 }],
    ["a credential kept from before H55", { hasCredentials: true }],
  ])("needs cleanup when off with %s", (_name, facts) => {
    expect(state(facts)).toBe("needs_cleanup");
  });

  it("says what a plugin writes from its capabilities", () => {
    expect(pluginWrites(["source.read", "createRecord", "editRecord"])).toEqual(["transactions"]);
    expect(pluginWrites(["leaveCalendar", "provider.write"])).toEqual(["leave"]);
    expect(pluginWrites(["leaveCalendar"])).toEqual([]);
    expect(pluginWrites([])).toEqual([]);
  });
});

describe("where an account stands with its source (H56)", () => {
  const OFF = new Date("2026-11-20T10:00:00Z");
  const READ = new Date("2026-11-19T07:00:00Z");

  it("is live while its source is on, or a provider of the core", () => {
    const synced = { provider: "plugin:wallet", lastSyncedAt: READ };
    expect(accountSource(synced, { plugin: { active: true, deactivatedAt: OFF } }).sourceState).toBe("live");
    expect(accountSource({ provider: "binance", lastSyncedAt: READ }, {}).sourceState).toBe("live");
  });

  it("is stopped while its plugin is off: since it was turned off, else since its last reading", () => {
    const synced = { provider: "plugin:wallet", lastSyncedAt: READ };
    expect(accountSource(synced, { plugin: { active: false, deactivatedAt: OFF } })).toEqual({
      sourceState: "stopped",
      formerSource: null,
      stoppedSince: OFF,
    });
    expect(accountSource(synced, { plugin: { active: false, deactivatedAt: null } }).stoppedSince).toBe(READ);
  });

  it("is former for an account kept by hand that came from a source, and none for any other", () => {
    const manual = { provider: null, lastSyncedAt: READ };
    expect(accountSource(manual, { former: { provider: "plugin:wallet", until: OFF } })).toEqual({
      sourceState: "former",
      formerSource: "plugin:wallet",
      stoppedSince: OFF,
    });
    expect(accountSource(manual, {})).toEqual({ sourceState: null, formerSource: null, stoppedSince: null });
  });
});
