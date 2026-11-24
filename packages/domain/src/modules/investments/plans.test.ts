import { describe, expect, it } from "vitest";
import {
  dueDates,
  endedBy,
  instalment,
  PRICE_SCALE,
  QUANTITY_SCALE,
  quantityFor,
  type PlanSchedule,
} from "./rules";
import { parseDecimal } from "../../shared/money";

const price = (value: string) => parseDecimal(value, PRICE_SCALE);
const qty = (value: string) => parseDecimal(value, QUANTITY_SCALE);
const monthly = (over: Partial<PlanSchedule> = {}): PlanSchedule => ({
  frequency: "month",
  interval: 1,
  day: 5,
  startOn: "2026-01-10",
  endOn: null,
  runsLimit: null,
  ...over,
});

describe("the due dates of a plan", () => {
  it("fall on its day from its start, the month's last when the day is past it", () => {
    expect(dueDates(monthly(), "2026-04-30")).toEqual(["2026-02-05", "2026-03-05", "2026-04-05"]);
    expect(dueDates(monthly({ day: 31, startOn: "2026-01-31" }), "2026-03-31")).toEqual([
      "2026-01-31",
      "2026-02-28",
      "2026-03-31",
    ]);
  });

  it("go every N months or quarters, and every N weeks on a weekday", () => {
    expect(dueDates(monthly({ frequency: "quarter", startOn: "2026-01-05" }), "2026-12-31")).toEqual([
      "2026-01-05",
      "2026-04-05",
      "2026-07-05",
      "2026-10-05",
    ]);
    // 2026-11-23 is a Monday: every two weeks on Friday (5).
    expect(
      dueDates(monthly({ frequency: "week", interval: 2, day: 5, startOn: "2026-11-23" }), "2026-12-31"),
    ).toEqual(["2026-11-27", "2026-12-11", "2026-12-25"]);
  });

  it("stop at the end day or after the number of instalments", () => {
    expect(dueDates(monthly({ endOn: "2026-03-05" }), "2026-12-31")).toEqual(["2026-02-05", "2026-03-05"]);
    expect(dueDates(monthly({ runsLimit: 2 }), "2026-12-31")).toEqual(["2026-02-05", "2026-03-05"]);
    expect(endedBy(monthly({ runsLimit: 2 }), "2026-03-05")).toBe(true);
    expect(endedBy(monthly({ runsLimit: 2 }), "2026-03-04")).toBe(false);
  });
});

describe("what an instalment buys", () => {
  it("is fractions to 6 decimals, or whole units, never more than its amount", () => {
    expect(quantityFor(100_00n, price("37.12"), true)).toBe(qty("2.693965"));
    expect(quantityFor(100_00n, price("37.12"), false)).toBe(qty("2"));
    expect(quantityFor(100_00n, price("0"), true)).toBe(0n);
  });

  it("spends quantity × price, with a fixed fee or a rate of it", () => {
    const plan = {
      amountCents: 100_00n,
      quantity: null,
      fractions: false,
      fee: { cents: 2_95n, rate: null },
    };
    expect(instalment(plan, price("37.12"))).toEqual({
      quantity: qty("2"),
      spentCents: 74_24n,
      feeCents: 2_95n,
    });
    const byRate = { ...plan, quantity: qty("3"), fee: { cents: null, rate: parseDecimal("0.0019", 10) } };
    expect(instalment(byRate, price("100"))).toEqual({
      quantity: qty("3"),
      spentCents: 300_00n,
      feeCents: 57n,
    });
  });
});
