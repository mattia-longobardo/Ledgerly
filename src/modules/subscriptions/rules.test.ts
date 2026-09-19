import { describe, expect, it } from "vitest";
import {
  addCycles,
  cadenceOf,
  type CheckedSubscription,
  dueDates,
  monthlyEquivalent,
  nextCharge,
  periodOf,
  planCharges,
  suggestionsFrom,
  toleranceParts,
  withinTolerance,
  yearlyEquivalent,
} from "./rules";

describe("equivalents (spec §7.5)", () => {
  it("turns each cycle into a month and a year, half-up to the cent", () => {
    expect(monthlyEquivalent(1_000n, "weekly")).toBe(4_333n); // 1.000 × 52 / 12 = 4.333,33
    expect(monthlyEquivalent(1_099n, "monthly")).toBe(1_099n);
    expect(monthlyEquivalent(1_000n, "quarterly")).toBe(333n);
    expect(monthlyEquivalent(4_990n, "yearly")).toBe(416n); // 415,83
    expect(monthlyEquivalent(1_002n, "quarterly")).toBe(334n);
    expect(yearlyEquivalent(1_000n, "weekly")).toBe(52_000n);
    expect(yearlyEquivalent(1_099n, "monthly")).toBe(13_188n);
    expect(yearlyEquivalent(1_000n, "quarterly")).toBe(4_000n);
    expect(yearlyEquivalent(4_990n, "yearly")).toBe(4_990n);
  });
});

describe("the charge calendar", () => {
  it("keeps the anchor's day, or the last day of a shorter month", () => {
    expect(addCycles("2026-01-31", "monthly", 1)).toBe("2026-02-28");
    expect(addCycles("2026-01-31", "monthly", 2)).toBe("2026-03-31");
    expect(addCycles("2028-01-31", "monthly", 1)).toBe("2028-02-29");
    expect(addCycles("2026-03-31", "monthly", -1)).toBe("2026-02-28");
    expect(addCycles("2026-05-15", "quarterly", -2)).toBe("2025-11-15");
    expect(addCycles("2024-02-29", "yearly", 1)).toBe("2025-02-28");
    expect(addCycles("2026-09-01", "weekly", -2)).toBe("2026-08-18");
  });

  it("lists the charges between two dates, whichever side of them the anchor is", () => {
    expect(dueDates("2026-09-05", "monthly", "2026-06-01", "2026-09-30")).toEqual([
      "2026-06-05",
      "2026-07-05",
      "2026-08-05",
      "2026-09-05",
    ]);
    expect(dueDates("2027-03-10", "yearly", "2025-01-01", "2026-12-31")).toEqual([
      "2025-03-10",
      "2026-03-10",
    ]);
    expect(dueDates("2026-09-01", "weekly", "2026-09-02", "2026-09-20")).toEqual([
      "2026-09-08",
      "2026-09-15",
    ]);
  });

  it("gives a monthly-or-longer charge its calendar month, a weekly one three days either side", () => {
    expect(periodOf("2026-02-10", "monthly")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(periodOf("2026-02-10", "yearly")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(periodOf("2026-03-01", "weekly")).toEqual({ from: "2026-02-26", to: "2026-03-04" });
  });

  it("names the next charge not already paid", () => {
    expect(nextCharge("2026-09-25", "monthly", "2026-09-19", new Set())).toBe("2026-09-25");
    expect(nextCharge("2026-09-25", "monthly", "2026-09-19", new Set(["2026-09-25"]))).toBe("2026-10-25");
    expect(nextCharge("2025-01-05", "monthly", "2026-09-19", new Set())).toBe("2026-10-05");
  });
});

describe("tolerance", () => {
  it("reads the stored fraction exactly and compares in integers", () => {
    expect(toleranceParts("0.050000")).toBe(50_000n);
    expect(toleranceParts("1")).toBe(1_000_000n);
    expect(withinTolerance(1_050n, 1_000n, "0.05")).toBe(true);
    expect(withinTolerance(950n, 1_000n, "0.05")).toBe(true);
    expect(withinTolerance(1_051n, 1_000n, "0.05")).toBe(false);
    expect(withinTolerance(1_000n, 1_000n, "0")).toBe(true);
  });
});

describe("planCharges (spec §7.5)", () => {
  const netflix: CheckedSubscription = {
    id: "s-1",
    priceCents: 1_299n,
    cycle: "monthly",
    anchor: "2026-07-02",
    paymentAccountId: "acc-1",
    payeeMatch: "NET FLIX",
    tolerance: "0.05",
    createdOn: "2026-07-20",
    expected: new Map(),
  };
  const charge = (id: string, on: string, cents: bigint, payee = "Netflix.com", accountId = "acc-1") => ({
    id,
    accountId,
    on,
    cents,
    payee,
  });

  it("checks from the period under way at creation to a week ahead", () => {
    const plan = planCharges([netflix], [], "2026-09-19");
    expect(plan.map((row) => [row.dueOn, row.state])).toEqual([
      ["2026-07-02", "not_found"],
      ["2026-08-02", "not_found"],
      ["2026-09-02", "due"],
    ]);
  });

  it("pays a period with a matching movement, anywhere in its month, on the paying account only", () => {
    const plan = planCharges(
      [netflix],
      [
        charge("t-1", "2026-07-02", 1_299n),
        charge("t-2", "2026-08-30", 1_310n),
        charge("t-3", "2026-09-02", 1_299n, "Netflix", "acc-2"),
      ],
      "2026-09-19",
    );
    expect(plan.map((row) => [row.dueOn, row.state, row.transactionId, row.actualCents])).toEqual([
      ["2026-07-02", "paid", "t-1", 1_299n],
      ["2026-08-02", "paid", "t-2", 1_310n],
      ["2026-09-02", "due", null, null],
    ]);
  });

  it("flags an amount outside the tolerance and prefers the closest amount among candidates", () => {
    const plan = planCharges(
      [{ ...netflix, createdOn: "2026-09-19", anchor: "2026-09-02" }],
      [charge("t-1", "2026-09-02", 1_799n), charge("t-2", "2026-09-10", 1_499n)],
      "2026-09-19",
    );
    expect(plan).toEqual([
      expect.objectContaining({
        dueOn: "2026-09-02",
        state: "amount_differs",
        transactionId: "t-2",
        actualCents: 1_499n,
      }),
    ]);
  });

  it("is due only within seven days, and writes nothing for a charge further off", () => {
    const sub = { ...netflix, createdOn: "2026-09-01", anchor: "2026-09-26" };
    // August's period closed before the subscription existed: not checked.
    expect(planCharges([sub], [], "2026-09-19").map((row) => [row.dueOn, row.state])).toEqual([
      ["2026-09-26", "due"],
    ]);
    expect(planCharges([sub], [], "2026-09-18")).toEqual([]);
  });

  it("does not hold a yearly plan added today to last year's renewal", () => {
    const prime = { ...netflix, cycle: "yearly" as const, anchor: "2026-09-22", createdOn: "2026-09-19" };
    expect(planCharges([prime], [], "2026-09-19").map((row) => [row.dueOn, row.state])).toEqual([
      ["2026-09-22", "due"],
    ]);
  });

  it("gives one movement to one charge only, across subscriptions", () => {
    const twin = { ...netflix, id: "s-2", payeeMatch: "netflix" };
    const plan = planCharges(
      [netflix, twin].map((sub) => ({ ...sub, createdOn: "2026-09-19", anchor: "2026-09-02" })),
      [charge("t-1", "2026-09-02", 1_299n)],
      "2026-09-19",
    );
    expect(plan.map((row) => [row.subscriptionId, row.state, row.transactionId])).toEqual([
      ["s-1", "paid", "t-1"],
      ["s-2", "due", null],
    ]);
  });

  it("keeps the expected amount a period was first written with", () => {
    const plan = planCharges(
      [{ ...netflix, priceCents: 1_799n, expected: new Map([["2026-07-02", 1_299n]]) }],
      [charge("t-1", "2026-07-03", 1_299n)],
      "2026-09-19",
    );
    expect(plan[0]).toMatchObject({ dueOn: "2026-07-02", expectedCents: 1_299n, state: "paid" });
    expect(plan[1]).toMatchObject({ dueOn: "2026-08-02", expectedCents: 1_799n });
  });

  it("checks every account when none is set", () => {
    const plan = planCharges(
      [{ ...netflix, paymentAccountId: null, createdOn: "2026-09-19", anchor: "2026-09-02" }],
      [charge("t-1", "2026-09-02", 1_299n, "NETFLIX", "acc-9")],
      "2026-09-19",
    );
    expect(plan[0]).toMatchObject({ state: "paid", transactionId: "t-1" });
  });
});

describe("suggestions (spec §7.5)", () => {
  const pattern = (payeeKey: string, intervalDays: number, sign = -1) => ({
    payeeKey,
    sign,
    intervalDays,
    medianCents: sign * 1_299,
    nextExpectedOn: "2026-10-02",
    occurrences: 4,
  });
  const samples = new Map([
    ["netflix", { payee: "Netflix", accountId: "acc-1", categoryId: "cat-1", on: "2026-09-02" }],
    ["spotifyab", { payee: "Spotify AB", accountId: "acc-1", categoryId: null, on: "2026-09-11" }],
    ["gym", { payee: "Gym", accountId: "acc-1", categoryId: null, on: "2026-09-11" }],
    ["acmepayroll", { payee: "Acme payroll", accountId: "acc-1", categoryId: null, on: "2026-09-27" }],
  ]);

  it("maps the interval to a cycle, and has none for two weeks", () => {
    expect(cadenceOf(7)).toBe("weekly");
    expect(cadenceOf(14)).toBeNull();
    expect(cadenceOf(30)).toBe("monthly");
    expect(cadenceOf(91)).toBe("quarterly");
    expect(cadenceOf(365)).toBe("yearly");
    expect(cadenceOf(45)).toBeNull();
  });

  it("proposes the outgoing patterns no subscription covers yet", () => {
    const suggestions = suggestionsFrom(
      [
        { ...pattern("netflix", 30), medianCents: -1_299n },
        { ...pattern("spotifyab", 30), medianCents: -1_099n },
        { ...pattern("gym", 14), medianCents: -2_000n },
        { ...pattern("acmepayroll", 30, 1), medianCents: 250_000n },
      ],
      samples,
      [{ payeeMatch: "spotify" }, { payeeMatch: null }],
    );
    expect(suggestions).toEqual([
      {
        payeeKey: "netflix",
        name: "Netflix",
        payeeMatch: "Netflix",
        priceCents: 1_299n,
        cycle: "monthly",
        nextChargeOn: "2026-10-02",
        accountId: "acc-1",
        categoryId: "cat-1",
        occurrences: 4,
      },
    ]);
  });
});
