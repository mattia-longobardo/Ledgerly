import { describe, expect, it } from "vitest";
import { transferRhythm } from "./pension-present";

describe("transferRhythm", () => {
  const cometa = [
    { quarter: 1, month: 4, day: 20, nextYear: false },
    { quarter: 2, month: 7, day: 20, nextYear: false },
    { quarter: 3, month: 10, day: 20, nextYear: false },
    { quarter: 4, month: 1, day: 20, nextYear: true },
  ];

  it("reads Cometa's four deadlines as quarterly on the 20th", () => {
    expect(transferRhythm(cometa)).toEqual({ frequency: "quarterly", day: 20 });
  });

  it("gives no single day when the deadlines differ", () => {
    expect(transferRhythm([...cometa.slice(0, 3), { ...cometa[3], day: 15 }])).toEqual({
      frequency: "quarterly",
      day: null,
    });
  });

  it("reads twelve deadlines as monthly", () => {
    const monthly = Array.from({ length: 12 }, (_, index) => ({
      quarter: (index % 4) + 1,
      month: index + 1,
      day: 16,
      nextYear: false,
    }));
    expect(transferRhythm(monthly)).toEqual({ frequency: "monthly", day: 16 });
  });

  it("calls anything else custom, and an empty rule has no day", () => {
    expect(transferRhythm([])).toEqual({ frequency: "custom", day: null });
    expect(transferRhythm(cometa.slice(0, 2))).toEqual({ frequency: "custom", day: 20 });
  });
});
