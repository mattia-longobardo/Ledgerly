import { describe, expect, it } from "vitest";
import {
  allocateWholeShares,
  type AllocationInput,
  dueDates,
  endedBy,
  instalment,
  PRICE_SCALE,
  QUANTITY_SCALE,
  quantityFor,
  RATE_SCALE,
  spentAt,
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

// PERS-681 §2.3: the worked examples of the design (invented names and numbers).
const cents = (value: string) => parseDecimal(value, 2);
const line = (assetId: string, weightBp: number, unitPrice: string | null, rate: bigint | null = null) => ({
  assetId,
  weightBp,
  unitPrice: unitPrice === null ? null : price(unitPrice),
  rate,
});
const shares = (allocation: ReturnType<typeof allocateWholeShares>) =>
  allocation.lines.map((one) => [one.quantity / 10n ** 18n, one.spentCents, one.state]);
/** 1 € = 1.0800 $: what one dollar is worth in euro, as the ECB rate the operation stores. */
const USD_IN_EUR = parseDecimal("0.9259259259", RATE_SCALE);

describe("the whole shares of a basket's execution", () => {
  it("example 1: the carry grows, then buys a share more", () => {
    const run = (budget: string, a: string, b: string, c: string) =>
      allocateWholeShares(cents(budget), [line("A", 5000, a), line("B", 3000, b), line("C", 2000, c)]);
    const first = run("200", "41.30", "18.75", "9.10");
    expect(shares(first)).toEqual([
      [2n, 82_60n, "buy"],
      [3n, 56_25n, "buy"],
      [4n, 36_40n, "buy"],
    ]);
    expect([first.spentCents, first.carryOutCents]).toEqual([175_25n, 24_75n]);
    const second = run("224.75", "42", "19.10", "9.40");
    expect(second.lines[0].targetCents).toBe(112_37n);
    expect([second.spentCents, second.carryOutCents]).toEqual([178_90n, 45_85n]);
    const third = run("245.85", "42", "19.10", "9.40");
    expect([third.spentCents, third.carryOutCents]).toEqual([188_30n, 57_55n]);
    const fourth = run("257.55", "42", "19.10", "9.40");
    expect(shares(fourth).map((one) => one[0])).toEqual([3n, 4n, 5n]);
    expect([fourth.spentCents, fourth.carryOutCents]).toEqual([249_40n, 8_15n]);
  });

  it("example 2: a share dearer than its part skips the line, and its part is carried (M2)", () => {
    const first = allocateWholeShares(cents("100"), [line("A", 7000, "55"), line("B", 3000, "38")]);
    expect(shares(first)).toEqual([
      [1n, 55_00n, "buy"],
      [0n, 0n, "too_expensive"],
    ]);
    expect(first.carryOutCents).toBe(45_00n);
    const second = allocateWholeShares(cents("145"), [line("A", 7000, "55"), line("B", 3000, "38")]);
    expect([second.spentCents, second.carryOutCents]).toEqual([93_00n, 52_00n]);
  });

  it("example 3: an instrument in another currency is bought at its rate", () => {
    const run = allocateWholeShares(cents("150"), [
      line("A", 6000, "24.10"),
      line("B", 4000, "31", USD_IN_EUR),
    ]);
    expect(shares(run)).toEqual([
      [3n, 72_30n, "buy"],
      [2n, 57_41n, "buy"],
    ]);
    expect([run.spentCents, run.carryOutCents]).toEqual([129_71n, 20_29n]);
  });

  it("example 4: the real prices of the confirmation decide the carry", () => {
    const spent =
      spentAt(3n * 10n ** 18n, price("24.18"), null) + spentAt(2n * 10n ** 18n, price("31.05"), USD_IN_EUR);
    expect(spent).toBe(130_04n);
    expect(cents("150") - spent).toBe(19_96n);
  });

  it("spends nothing of a budget of 0 or below, and never more than the budget", () => {
    const lines = [line("A", 5000, "10"), line("B", 5000, "10")];
    expect(allocateWholeShares(0n, lines)).toMatchObject({ spentCents: 0n, carryOutCents: 0n });
    // A negative carry larger than the amount leaves a budget of 0 (§2.4).
    expect(allocateWholeShares(-5_00n, lines)).toMatchObject({ spentCents: 0n, carryOutCents: 0n });
    const ten: AllocationInput[] = Array.from({ length: 10 }, (_, index) => line(`I${index}`, 1000, "3.33"));
    const run = allocateWholeShares(cents("100"), ten);
    expect(run.lines.every((one) => one.quantity === 3n * 10n ** 18n)).toBe(true);
    expect([run.spentCents, run.carryOutCents]).toEqual([99_90n, 10n]);
  });

  it("buys 10 instruments, each with its part of the budget (§8.1)", () => {
    const weights = [3000, 2000, 1000, 1000, 1000, 500, 500, 500, 250, 250];
    const run = allocateWholeShares(
      cents("1000"),
      weights.map((weight, index) => line(`I${index}`, weight, "7")),
    );
    expect(run.lines.map((one) => one.targetCents)).toEqual(
      [300, 200, 100, 100, 100, 50, 50, 50, 25, 25].map((euro) => BigInt(euro) * 100n),
    );
    expect(shares(run).map((one) => one[0])).toEqual([42n, 28n, 14n, 14n, 14n, 7n, 7n, 7n, 3n, 3n]);
    expect([run.spentCents, run.carryOutCents]).toEqual([973_00n, 27_00n]);
  });

  it("gives a weight of 1 bp its part: a cheap share, or none when the part is below a cent (§8.1)", () => {
    const large = allocateWholeShares(cents("10000"), [line("A", 9999, "100"), line("B", 1, "0.99")]);
    expect(shares(large)).toEqual([
      [99n, 9900_00n, "buy"],
      [1n, 99n, "buy"],
    ]);
    expect(large.lines[1].targetCents).toBe(1_00n);
    expect(large.carryOutCents).toBe(99_01n);
    const small = allocateWholeShares(cents("50"), [line("A", 9999, "5"), line("B", 1, "0.01")]);
    expect(small.lines[1]).toMatchObject({ targetCents: 0n, quantity: 0n, state: "too_expensive" });
  });

  it("carries the whole budget when every line is skipped or has no price", () => {
    const run = allocateWholeShares(cents("50"), [line("A", 9999, "80"), line("B", 1, null)]);
    expect(shares(run)).toEqual([
      [0n, 0n, "too_expensive"],
      [0n, 0n, "price_missing"],
    ]);
    expect(run.lines[1].targetCents).toBe(0n);
    expect(run.carryOutCents).toBe(50_00n);
  });
});

describe("a daily plan", () => {
  it("falls on Monday to Friday only, every `interval` working days", () => {
    // 2026-11-27 is a Friday.
    const daily = monthly({ frequency: "day", startOn: "2026-11-28", day: 1 });
    expect(dueDates(daily, "2026-12-08")).toEqual([
      "2026-11-30",
      "2026-12-01",
      "2026-12-02",
      "2026-12-03",
      "2026-12-04",
      "2026-12-07",
      "2026-12-08",
    ]);
    expect(dueDates({ ...daily, startOn: "2026-11-27", interval: 2 }, "2026-12-07")).toEqual([
      "2026-11-27",
      "2026-12-01",
      "2026-12-03",
      "2026-12-07",
    ]);
  });
});
