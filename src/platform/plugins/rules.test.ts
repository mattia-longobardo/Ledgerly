import { describe, expect, it } from "vitest";
import type { PluginAccount, SyncResponse } from "./contract/calls";
import {
  bankState,
  hashState,
  instanceKeyOf,
  institutionOf,
  isReturnError,
  looksLikePrivateKey,
  maskIdentifier,
  measureReading,
  normalizePrivateKey,
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

describe("the state of a bank", () => {
  const now = new Date("2026-11-15T10:00:00Z");

  it("is expired past the end of the access, or when the access was refused", () => {
    expect(bankState({ state: "active", expiresAt: new Date("2026-11-15T09:59:59Z") }, now)).toBe("expired");
    expect(bankState({ state: "revoked", expiresAt: null }, now)).toBe("expired");
  });

  it("is active or in error otherwise", () => {
    expect(bankState({ state: "active", expiresAt: new Date("2027-01-01T00:00:00Z") }, now)).toBe("active");
    expect(bankState({ state: "error", expiresAt: null }, now)).toBe("error");
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
