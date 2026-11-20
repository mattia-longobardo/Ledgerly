import { describe, expect, it } from "vitest";
import { matchesMovement } from "./rules";

// The pure part of the movement matcher (rewrite plan §10.11, E7).

const debit = { payee: "SDD Fondo Pensione", note: "Mandato IT66 ZZZ1.2345", cents: 100_00n };

describe("matchesMovement", () => {
  it("matches every movement with neither text nor amount", () => {
    expect(matchesMovement({}, debit)).toBe(true);
  });

  it("matches the payee text as a payee key: no spaces, no case", () => {
    expect(matchesMovement({ match: { by: "payee", text: "fondopensione" } }, debit)).toBe(true);
    expect(matchesMovement({ match: { by: "payee", text: "Fondo  PENSIONE" } }, debit)).toBe(true);
    expect(matchesMovement({ match: { by: "payee", text: "mandato" } }, debit)).toBe(false);
  });

  it("finds an identifier in the payee or in the bank's text, without spaces, dots or case", () => {
    expect(matchesMovement({ match: { by: "identifier", text: "it66zzz12345" } }, debit)).toBe(true);
    expect(matchesMovement({ match: { by: "identifier", text: "IT66 ZZZ 1.2345" } }, debit)).toBe(true);
    expect(matchesMovement({ match: { by: "identifier", text: "IT77ZZZ" } }, debit)).toBe(false);
  });

  it("never matches an empty text or identifier", () => {
    expect(matchesMovement({ match: { by: "payee", text: "  " } }, debit)).toBe(false);
    expect(matchesMovement({ match: { by: "identifier", text: " . " } }, debit)).toBe(false);
    expect(
      matchesMovement({ match: { by: "identifier", text: "IT66" } }, { ...debit, payee: null, note: null }),
    ).toBe(false);
  });

  it("matches the exact amount only", () => {
    expect(matchesMovement({ amountCents: 100_00n }, debit)).toBe(true);
    expect(matchesMovement({ amountCents: 100_01n }, debit)).toBe(false);
    expect(matchesMovement({ amountCents: 100_00n, match: { by: "payee", text: "Esselunga" } }, debit)).toBe(
      false,
    );
  });
});
