import { describe, expect, it } from "vitest";
import { counterpartOf } from "../../calls";
import { editStartOf } from "./edit-start";

const EVENT = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const INSTRUMENT = "1b2c3d4e-5f6a-4b7c-8d9e-0f1a2b3c4d5e";
const ACCOUNT = "2c3d4e5f-6a7b-4c8d-9e0f-1a2b3c4d5e6f";
const ROW = { name: "Test fund", currency: "USD" };

describe("the start of «Edit»", () => {
  it("types a purchase back in the person's separators, with its instrument and market", () => {
    const start = editStartOf(
      EVENT,
      {
        kind: "buy",
        instrumentId: INSTRUMENT,
        mic: "XNAS",
        on: "2026-10-02",
        quantity: "3.5",
        unitPrice: "10.25",
        amount: null,
        fee: "1.50",
        fxRate: null,
        note: null,
      },
      ROW,
      "it-IT",
    );
    expect(start).toMatchObject({
      eventId: EVENT,
      kind: "buy",
      day: "2026-10-02",
      typed: {
        instrument: { instrumentId: INSTRUMENT, mic: "XNAS", name: "Test fund", currency: "USD" },
        how: "price",
        quantity: "3,5",
        unitPrice: "10,25",
        amount: "",
        fee: "1,50",
        fxRate: "",
        note: "",
      },
    });
  });

  it("opens a purchase by amount on the amount", () => {
    const start = editStartOf(
      EVENT,
      {
        kind: "buy",
        instrumentId: INSTRUMENT,
        mic: null,
        on: "2026-10-02",
        quantity: null,
        unitPrice: null,
        amount: "100.00",
        fee: null,
        fxRate: "1.1",
        note: "n",
      },
      ROW,
      "en-US",
    );
    expect(start?.typed).toMatchObject({ how: "amount", amount: "100.00", fxRate: "1.1", note: "n" });
  });

  it("keeps a deposit's side, so the form sends it back as it was", () => {
    const sides = [
      { body: { transactionId: EVENT, counterpart: null }, sent: { transactionId: EVENT } },
      {
        body: { transactionId: null, counterpart: { kind: "account" as const, accountId: ACCOUNT } },
        sent: { counterpart: { kind: "account", accountId: ACCOUNT } },
      },
      {
        body: { transactionId: null, counterpart: { kind: "outside" as const } },
        sent: { counterpart: { kind: "outside" } },
      },
      {
        body: { transactionId: null, counterpart: { kind: "none" as const } },
        sent: { counterpart: { kind: "none" } },
      },
      { body: { transactionId: null, counterpart: null }, sent: {} },
    ];
    for (const { body, sent } of sides) {
      const start = editStartOf(
        EVENT,
        { kind: "deposit", on: "2026-10-02", amount: "50.00", note: null, ...body },
        ROW,
        "en-US",
      );
      expect(start?.kind).toBe("deposit");
      expect(counterpartOf(start?.typed?.counterpart ?? "")).toEqual(sent);
    }
  });

  it("opens no form for a kind «Record operation» does not write", () => {
    expect(
      editStartOf(
        EVENT,
        { kind: "valuation", holdingId: EVENT, on: "2026-10-02", unitPrice: "1", amount: null, note: null },
        ROW,
        "en-US",
      ),
    ).toBeNull();
  });
});
