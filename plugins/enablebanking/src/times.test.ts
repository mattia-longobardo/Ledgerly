import { describe, expect, it } from "vitest";
import { timeFromText } from "./times";

// Synthetic texts in the wording of the bank: no real movement.
const card = (when: string) => `PAGAMENTO CARTA 0000 del ${when} presso NEGOZIO DI PROVA`;

describe("the time a bank writes in the text", () => {
  it("reads the day and the time, in the bank's zone (Rome: UTC+1 in winter, UTC+2 in summer)", () => {
    expect(timeFromText(card("12/11/2026 alle ore 14:32"))).toEqual({
      day: "2026-11-12",
      instant: "2026-11-12T13:32:00.000Z",
    });
    expect(timeFromText(card("15/07/2026 alle ore 09:05"))).toEqual({
      day: "2026-07-15",
      instant: "2026-07-15T07:05:00.000Z",
    });
  });

  it("reads the wording with more than one space or a line break between its words (transfers)", () => {
    expect(timeFromText("BONIFICO DA PROVA del 12/11/2026  alle ore 14:32")?.instant).toBe(
      "2026-11-12T13:32:00.000Z",
    );
    expect(timeFromText("del 12/11/2026\nalle  ore 14:32")?.day).toBe("2026-11-12");
  });

  it("gives nothing for a text without the time, without the wording, or empty", () => {
    expect(timeFromText(card("12/11/2026"))).toBeNull();
    expect(timeFromText("BONIFICO A FAVORE DI PROVA")).toBeNull();
    expect(timeFromText("")).toBeNull();
  });

  it("keeps the days at the edges of a month and of a year on their day", () => {
    expect(timeFromText(card("31/01/2026 alle ore 23:59"))).toEqual({
      day: "2026-01-31",
      instant: "2026-01-31T22:59:00.000Z",
    });
    expect(timeFromText(card("01/03/2026 alle ore 00:10"))).toEqual({
      day: "2026-03-01",
      instant: "2026-02-28T23:10:00.000Z",
    });
    expect(timeFromText(card("29/02/2028 alle ore 12:00"))?.day).toBe("2028-02-29");
    expect(timeFromText(card("31/12/2026 alle ore 23:30"))).toEqual({
      day: "2026-12-31",
      instant: "2026-12-31T22:30:00.000Z",
    });
  });

  it("refuses a day or a time that does not exist", () => {
    expect(timeFromText(card("31/04/2026 alle ore 10:00"))).toBeNull();
    expect(timeFromText(card("29/02/2026 alle ore 10:00"))).toBeNull();
    expect(timeFromText(card("12/13/2026 alle ore 10:00"))).toBeNull();
    expect(timeFromText(card("12/11/2026 alle ore 24:00"))).toBeNull();
    expect(timeFromText(card("12/11/2026 alle ore 10:60"))).toBeNull();
  });

  it("resolves the days of the change of time: a skipped time moves forward, a repeated one is the first", () => {
    // 29/03/2026: 02:00 becomes 03:00 in Rome. 02:30 does not exist: 03:30 summer time.
    expect(timeFromText(card("29/03/2026 alle ore 02:30"))?.instant).toBe("2026-03-29T01:30:00.000Z");
    expect(timeFromText(card("29/03/2026 alle ore 03:30"))?.instant).toBe("2026-03-29T01:30:00.000Z");
    // 25/10/2026: 03:00 becomes 02:00. 02:30 happens twice: the first, still summer time.
    expect(timeFromText(card("25/10/2026 alle ore 02:30"))?.instant).toBe("2026-10-25T00:30:00.000Z");
    expect(timeFromText(card("25/10/2026 alle ore 04:00"))?.instant).toBe("2026-10-25T03:00:00.000Z");
  });

  it("takes a dot as the separator of the time", () => {
    expect(timeFromText(card("12/11/2026 alle ore 14.32"))?.instant).toBe("2026-11-12T13:32:00.000Z");
  });
});
