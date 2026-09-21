import { describe, expect, it } from "vitest";
import {
  dueMoment,
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
  const charge = (
    id: string,
    on: string,
    cents: bigint,
    payee = "Netflix.com",
    accountId = "acc-1",
    note: string | null = null,
  ) => ({
    id,
    accountId,
    on,
    cents,
    payee,
    note,
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

  it("matches the bank's own text as well as the payee, which is what the field promises", () => {
    // Reported 2026-09-21: a car rental paid by direct debit. The payee is whatever the bank calls
    // the counterpart; the number that names the mandate is in the description, and the field is
    // labelled "the expense description contains". It was only ever read against the payee.
    const rental = {
      ...netflix,
      id: "s-roc",
      priceCents: 58_438n,
      payeeMatch: "2868921",
      createdOn: "2026-09-01",
      anchor: "2026-09-15",
    };
    const sdd = charge(
      "t-1",
      "2026-09-15",
      58_438n,
      "ADDEBITO SDD",
      "acc-1",
      "NOLEGGIO T-ROC - MANDATO 2868921",
    );
    expect(planCharges([rental], [sdd], "2026-09-20").map((row) => [row.dueOn, row.state])).toEqual([
      ["2026-09-15", "paid"],
    ]);
  });

  it("still matches a payee when the description says nothing", () => {
    const plan = planCharges([netflix], [charge("t-1", "2026-09-02", 1_299n)], "2026-09-19");
    expect(plan.map((row) => [row.dueOn, row.state])).toContainEqual(["2026-09-02", "paid"]);
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

  it("checks a charge from before the subscription existed, but never claims it", () => {
    // Reported 2026-09-21: a car rental added on 21 September with its next charge on 15 October
    // announced "expected on 15 Sep 2026 · not found yet" — a charge invented by the look-back,
    // from a month the plan had never been asked about, and then held against it.
    const rental = {
      ...netflix,
      id: "s-roc",
      priceCents: 58_438n,
      payeeMatch: "T-Roc",
      createdOn: "2026-09-21",
      anchor: "2026-10-15",
    };
    expect(planCharges([rental], [], "2026-09-21")).toEqual([]);
    // The look-back itself stays: the same charge, once a movement matches it, is reported paid.
    const paid = planCharges([rental], [charge("t-1", "2026-09-15", 58_438n, "T-Roc")], "2026-09-21");
    expect(paid.map((row) => [row.dueOn, row.state])).toEqual([["2026-09-15", "paid"]]);
    // And once the horizon reaches it, the charge that shows up is October's.
    expect(planCharges([rental], [], "2026-10-10").map((row) => [row.dueOn, row.state])).toEqual([
      ["2026-10-15", "due"],
    ]);
  });

  it("claims the anchor itself even when it is older than the subscription here", () => {
    // "The next charge is the 2nd", said on the 20th, names that charge: it is the person's own
    // statement, so it is owed and reported, unlike the months the look-back merely reached. Its
    // July window is still open on the 20th, so it reads `due`; what matters is that it is there.
    const sub = { ...netflix, createdOn: "2026-07-20", anchor: "2026-07-02" };
    expect(planCharges([sub], [], "2026-07-20").map((row) => [row.dueOn, row.state])).toEqual([
      ["2026-07-02", "due"],
    ]);
    // Once July has closed it becomes the missing charge it really is.
    expect(planCharges([sub], [], "2026-08-05").map((row) => [row.dueOn, row.state])).toContainEqual([
      "2026-07-02",
      "not_found",
    ]);
  });

  it("still looks back over the period under way when the subscription was created", () => {
    // The look-back exists for this: an anchor in the past, and a charge already paid earlier in
    // the month the subscription was added. Clamping to the anchor must not take that away.
    const sub = { ...netflix, createdOn: "2026-09-19", anchor: "2026-09-02" };
    const plan = planCharges([sub], [charge("t-1", "2026-09-02", 1_299n)], "2026-09-19");
    expect(plan.map((row) => [row.dueOn, row.state])).toEqual([["2026-09-02", "paid"]]);
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

describe("dueMoment", () => {
  it("is the day of the month for a monthly subscription: the month is every month", () => {
    expect(dueMoment("monthly", "2026-09-15")).toEqual({ kind: "day", day: 15 });
  });

  it("is the quarter for a quarterly one, whatever day inside it falls", () => {
    expect(dueMoment("quarterly", "2026-01-31")).toEqual({ kind: "quarter", quarter: 1 });
    expect(dueMoment("quarterly", "2026-04-01")).toEqual({ kind: "quarter", quarter: 2 });
    expect(dueMoment("quarterly", "2026-09-15")).toEqual({ kind: "quarter", quarter: 3 });
    expect(dueMoment("quarterly", "2026-12-31")).toEqual({ kind: "quarter", quarter: 4 });
  });

  it("is the month for a yearly one", () => {
    expect(dueMoment("yearly", "2026-09-15")).toEqual({ kind: "month", month: 9 });
  });

  it("is the weekday for a weekly one, Sunday being 0", () => {
    // 2026-09-21 is a Monday.
    expect(dueMoment("weekly", "2026-09-21")).toEqual({ kind: "weekday", weekday: 1 });
    expect(dueMoment("weekly", "2026-09-20")).toEqual({ kind: "weekday", weekday: 0 });
  });
});
