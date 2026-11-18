import { describe, expect, it } from "vitest";
import {
  competencePeriod,
  type DebitPlan,
  debitPeriodOf,
  debitStatus,
  dueOn,
  hasDueDates,
  monthlyOf,
  nextDueDates,
  NO_CALENDAR,
  parseDueEntries,
  periodEnd,
  periodIndexOf,
  periodStart,
  ruleOfEntries,
} from "./sources";

const QUARTERLY = { rule: { day: 20, offsetMonths: 1 }, entries: [] };

describe("the accrual periods of a payslip source", () => {
  it("counts a month as a month or as its quarter", () => {
    expect(periodIndexOf("2026-05-01", "month")).toBe(5);
    expect(periodIndexOf("2026-05-01", "quarter")).toBe(2);
    expect(periodIndexOf("2026-12-31", "quarter")).toBe(4);
  });

  it("gives a period its first month and its last day", () => {
    expect(periodStart(2026, 2, "quarter")).toBe("2026-04-01");
    expect(periodEnd(2026, 2, "quarter")).toBe("2026-06-30");
    expect(periodStart(2026, 2, "month")).toBe("2026-02-01");
    expect(periodEnd(2028, 2, "month")).toBe("2028-02-29");
  });

  it("reads a payslip's quarter for a quarterly source, and its month for a monthly one", () => {
    const may = { payrollPeriod: "2026-05-01", quarter: 2 };
    expect(competencePeriod(may, "quarter")).toBe(2);
    expect(competencePeriod(may, "month")).toBe(5);
    // A payslip with no month of its own (a thirteenth) closes the quarter it states.
    expect(competencePeriod({ payrollPeriod: null, quarter: 4 }, "month")).toBe(12);
    expect(competencePeriod({ payrollPeriod: null, quarter: 4 }, "quarter")).toBe(4);
  });
});

describe("the due date of a period's transfer", () => {
  it("is the day of the rule, so many months after the period's last month", () => {
    expect(dueOn(2026, 1, "quarter", QUARTERLY)).toBe("2026-04-20");
    expect(dueOn(2026, 3, "quarter", QUARTERLY)).toBe("2026-10-20");
    // The fourth quarter is due in January of the year after.
    expect(dueOn(2026, 4, "quarter", QUARTERLY)).toBe("2027-01-20");
    expect(dueOn(2026, 11, "month", { rule: { day: 16, offsetMonths: 1 }, entries: [] })).toBe("2026-12-16");
    expect(dueOn(2026, 12, "month", { rule: { day: 16, offsetMonths: 1 }, entries: [] })).toBe("2027-01-16");
  });

  it("falls in the period's own last month with no months after, the day held to the month's length", () => {
    const sameMonth = { rule: { day: 31, offsetMonths: 0 }, entries: [] };
    expect(dueOn(2026, 2, "month", sameMonth)).toBe("2026-02-28");
    expect(dueOn(2026, 1, "quarter", sameMonth)).toBe("2026-03-31");
  });

  it("has no due date without a rule: nothing is ever late", () => {
    expect(hasDueDates(NO_CALENDAR)).toBe(false);
    expect(dueOn(2026, 1, "quarter", NO_CALENDAR)).toBeNull();
    expect(nextDueDates("quarter", NO_CALENDAR, "2026-05-01")).toEqual([]);
  });

  it("lets explicit dates win, and leaves a period they do not name without one", () => {
    const calendar = {
      rule: { day: 20, offsetMonths: 1 },
      entries: [
        { period: 1, month: 5, day: 10, nextYear: false },
        { period: 4, month: 2, day: 15, nextYear: true },
      ],
    };
    expect(dueOn(2026, 1, "quarter", calendar)).toBe("2026-05-10");
    expect(dueOn(2026, 4, "quarter", calendar)).toBe("2027-02-15");
    expect(dueOn(2026, 2, "quarter", calendar)).toBeNull();
  });

  it("reads a stored schedule, one well-formed entry per period, with the name the period had before", () => {
    const stored = [
      { quarter: 2, month: 7, day: 20, nextYear: false },
      { period: 1, month: 4, day: 20, nextYear: false },
      { period: 1, month: 5, day: 1, nextYear: false },
      { period: 9, month: 4, day: 20, nextYear: false },
      { period: 3, month: 13, day: 20, nextYear: false },
      "not an entry",
    ];
    expect(parseDueEntries(stored, "quarter")).toEqual([
      { period: 1, month: 4, day: 20, nextYear: false },
      { period: 2, month: 7, day: 20, nextYear: false },
    ]);
    expect(parseDueEntries(null, "quarter")).toEqual([]);
  });

  it("finds the rule that says the same dates as four explicit ones, or none", () => {
    const twentieth = [
      { period: 1, month: 4, day: 20, nextYear: false },
      { period: 2, month: 7, day: 20, nextYear: false },
      { period: 3, month: 10, day: 20, nextYear: false },
      { period: 4, month: 1, day: 20, nextYear: true },
    ];
    expect(ruleOfEntries(twentieth, "quarter")).toEqual({ day: 20, offsetMonths: 1 });
    expect(ruleOfEntries(twentieth.slice(0, 3), "quarter")).toBeNull();
    expect(ruleOfEntries([{ ...twentieth[0], day: 15 }, ...twentieth.slice(1)], "quarter")).toBeNull();
  });

  it("lists the next due dates from today on, oldest first", () => {
    expect(nextDueDates("quarter", QUARTERLY, "2026-05-01")).toEqual([
      "2026-07-20",
      "2026-10-20",
      "2027-01-20",
      "2027-04-20",
    ]);
    expect(
      nextDueDates("month", { rule: { day: 16, offsetMonths: 1 }, entries: [] }, "2026-12-20", 2),
    ).toEqual(["2027-01-16", "2027-02-16"]);
  });
});

describe("the periods of a recurring debit (every N weeks, months or years)", () => {
  const plan = (overrides: Partial<DebitPlan>): DebitPlan => ({
    frequency: { count: 1, unit: "month" },
    day: 5,
    startOn: "2026-01-10",
    endOn: null,
    ...overrides,
  });

  it("cuts every month by calendar month, with the expected day inside it", () => {
    expect(debitPeriodOf(plan({}), "2026-03-17")).toEqual({
      from: "2026-03-01",
      to: "2026-03-31",
      expectedOn: "2026-03-05",
    });
    // The day is held to the month's length.
    expect(debitPeriodOf(plan({ day: 31 }), "2026-02-10")?.expectedOn).toBe("2026-02-28");
  });

  it("cuts every 3 months from the month of the start", () => {
    const quarterly = plan({ frequency: { count: 3, unit: "month" }, startOn: "2026-02-10" });
    expect(debitPeriodOf(quarterly, "2026-04-30")).toEqual({
      from: "2026-02-01",
      to: "2026-04-30",
      expectedOn: "2026-02-05",
    });
    expect(debitPeriodOf(quarterly, "2026-05-01")?.from).toBe("2026-05-01");
  });

  it("cuts every year from the month of the start: one debit each December", () => {
    const yearly = plan({ frequency: { count: 1, unit: "year" }, day: 15, startOn: "2025-12-01" });
    expect(debitPeriodOf(yearly, "2026-11-30")).toEqual({
      from: "2025-12-01",
      to: "2026-11-30",
      expectedOn: "2025-12-15",
    });
    expect(debitPeriodOf(yearly, "2026-12-01")?.expectedOn).toBe("2026-12-15");
  });

  it("cuts every 2 weeks from the start day itself", () => {
    const fortnight = plan({ frequency: { count: 2, unit: "week" }, day: null, startOn: "2026-01-05" });
    expect(debitPeriodOf(fortnight, "2026-01-18")).toEqual({
      from: "2026-01-05",
      to: "2026-01-18",
      expectedOn: "2026-01-05",
    });
    expect(debitPeriodOf(fortnight, "2026-01-19")?.from).toBe("2026-01-19");
  });

  it("has no period before the start or after the end", () => {
    expect(debitPeriodOf(plan({}), "2026-01-09")).toBeNull();
    expect(debitPeriodOf(plan({ endOn: "2026-06-30" }), "2026-07-01")).toBeNull();
  });

  const status = (todayOn: string, contributions: string[], overrides: Partial<DebitPlan> = {}) =>
    debitStatus({ plan: plan(overrides), active: true, expectsAmount: true, contributions, todayOn });

  it("says found for a contribution inside the running period, whatever the day", () => {
    expect(status("2026-03-20", ["2026-02-05", "2026-03-07"])).toEqual({ kind: "found", on: "2026-03-07" });
  });

  it("awaits until the expected day and its grace have passed, then says missing", () => {
    expect(status("2026-03-08", ["2026-02-05"])).toEqual({ kind: "awaited" });
    expect(status("2026-03-09", ["2026-02-05"])).toEqual({ kind: "missing", by: "2026-03-08" });
  });

  it("works by period, not by month: a quarterly debit found in February is not missing in April", () => {
    const quarterly = { frequency: { count: 3, unit: "month" as const }, startOn: "2026-02-01" };
    expect(status("2026-04-25", ["2026-02-06"], quarterly)).toEqual({ kind: "found", on: "2026-02-06" });
    // The next period opens in May: its debit is awaited, then missing.
    expect(status("2026-05-06", ["2026-02-06"], quarterly)).toEqual({ kind: "awaited" });
    expect(status("2026-05-20", ["2026-02-06"], quarterly)).toEqual({ kind: "missing", by: "2026-05-08" });
  });

  it("expects nothing from a paused source, a plan with no day or amount, or a plan that ended", () => {
    const base = { plan: plan({}), contributions: [], todayOn: "2026-03-20" };
    expect(debitStatus({ ...base, active: false, expectsAmount: true })).toEqual({ kind: "none" });
    expect(debitStatus({ ...base, active: true, expectsAmount: false })).toEqual({ kind: "none" });
    expect(status("2026-03-20", [], { day: null })).toEqual({ kind: "none" });
    expect(status("2026-09-20", [], { endOn: "2026-06-30" })).toEqual({ kind: "none" });
  });

  it("brings the expected amount to a month, for the projection", () => {
    expect(monthlyOf(25_100n, { count: 1, unit: "month" })).toBe(25_100n);
    expect(monthlyOf(30_000n, { count: 3, unit: "month" })).toBe(10_000n);
    expect(monthlyOf(120_000n, { count: 1, unit: "year" })).toBe(10_000n);
    expect(monthlyOf(6_000n, { count: 2, unit: "week" })).toBe(13_000n);
  });
});
