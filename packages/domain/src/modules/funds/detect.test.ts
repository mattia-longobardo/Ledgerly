import { describe, expect, it } from "vitest";
import { carriesKey, recurrenceKeyOf, summarise } from "./detect";

/*
  The owner's ask (2026-09-20): pick one charge of a PAC and have the app find the same charge in
  the past and expect it in the future — "without ChatGPT if there is a way", and there is. A direct
  debit carries a creditor identifier and a mandate reference, both with a shape the rulebook fixes.
*/
describe("what makes one charge the same charge", () => {
  it("reads the creditor identifier, however the bank spaces it", () => {
    expect(
      recurrenceKeyOf({
        payee: "FONDO ESEMPIO SGR",
        note: "Addebito SDD - Id creditore IT66 ZZZ 12345678901234 - rata mensile",
      }),
    ).toEqual({ kind: "creditor", text: "IT66ZZZ12345678901234" });
  });

  it("never takes an IBAN for a creditor: that would match the whole account", () => {
    // An Italian IBAN fits the same shape. Unlabelled and without the ZZZ business code it is left
    // alone, and the movement is recognised by its payee instead.
    expect(
      recurrenceKeyOf({ payee: "FONDO ESEMPIO", note: "Bonifico su IT60X0542811101000000123456" }),
    ).toEqual({ kind: "payee", text: "FONDO ESEMPIO" });
  });

  it("falls back to the mandate reference, then to the payee", () => {
    expect(recurrenceKeyOf({ payee: "PAC Esempio", note: "Rif. mandato: MND-2024-00871 addebito" })).toEqual({
      kind: "mandate",
      text: "MND-2024-00871",
    });
    expect(recurrenceKeyOf({ payee: "PAC Esempio", note: "addebito mensile" })).toEqual({
      kind: "payee",
      text: "PAC Esempio",
    });
    // Nothing to be recognised by is an answer too, not a guess.
    expect(recurrenceKeyOf({ payee: null, note: null })).toBeNull();
  });

  it("recognises the same charge again, wherever the identifier was printed", () => {
    const key = recurrenceKeyOf({ payee: "X", note: "Id creditore IT66ZZZ12345678901234" })!;
    expect(carriesKey({ payee: "ALTRO NOME", note: "it66zzz12345678901234 rata" }, key)).toBe(true);
    expect(carriesKey({ payee: "ALTRO NOME", note: "IT66ZZZ99999999999999" }, key)).toBe(false);
    // A payee key still matches the way the deposit rules always have: loosely, ignoring case.
    const payeeKey = recurrenceKeyOf({ payee: "PAC Esempio", note: null })!;
    expect(carriesKey({ payee: "SDD PAC  ESEMPIO SGR", note: null }, payeeKey)).toBe(true);
  });
});

describe("what the charges carrying one key add up to", () => {
  const key = { kind: "creditor" as const, text: "IT66ZZZ12345678901234" };
  const charges = [
    { on: "2026-03-05" as const, cents: 20_000n },
    { on: "2026-04-06" as const, cents: 20_000n },
    { on: "2026-05-05" as const, cents: 25_000n },
  ];

  it("reads the usual amount, the gap and the day of the month off them", () => {
    const found = summarise(key, charges);
    expect(found).toMatchObject({
      first: "2026-03-05",
      last: "2026-05-05",
      // The middle amount, so one raised instalment does not move it.
      medianCents: 20_000n,
      dayOfMonth: 5,
    });
    expect(found.intervalDays).toBeGreaterThanOrEqual(29);
    expect(found.intervalDays).toBeLessThanOrEqual(32);
  });

  it("answers what one charge can answer, and no more", () => {
    const one = summarise(key, [charges[0]]);
    expect(one).toMatchObject({ first: "2026-03-05", medianCents: 20_000n, intervalDays: null });
    expect(summarise(key, [])).toMatchObject({ first: null, medianCents: null, dayOfMonth: null });
  });

  it("has no day of the month when the charges do not agree on one", () => {
    expect(
      summarise(key, [
        { on: "2026-03-05", cents: 20_000n },
        { on: "2026-04-21", cents: 20_000n },
      ]).dayOfMonth,
    ).toBeNull();
  });
});
