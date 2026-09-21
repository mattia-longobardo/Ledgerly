import { z } from "zod";
import { payeeKeyOf, RECURRENCE_BANDS } from "@/modules/transactions/rules";
import { addDays, type CivilDate, dayOfWeek, isCivilDate, lastDayOfMonth, monthKey } from "@/platform/dates";
import type { Cents } from "@/platform/money";

export const CYCLES = ["weekly", "monthly", "quarterly", "yearly"] as const;
export const SUBSCRIPTION_STATES = ["active", "paused", "cancelled"] as const;
export const CHARGE_STATES = ["paid", "amount_differs", "due", "not_found"] as const;

export type Cycle = (typeof CYCLES)[number];
export type SubscriptionState = (typeof SUBSCRIPTION_STATES)[number];
export type ChargeState = (typeof CHARGE_STATES)[number];

/** Utility at or below this is "low" (spec §7.5). */
export const LOW_UTILITY = 5;
/** A charge not found yet is `due` from this many days before its date (spec §7.5). */
export const DUE_WITHIN_DAYS = 7;
/** How many periods back the check keeps, at most. */
export const MAX_CHECKED_PERIODS = 24;
/** Half the span of a weekly charge's window, in days: a week split around its date. */
const WEEKLY_REACH = 3;

const MONTHS_PER_CYCLE: Record<Exclude<Cycle, "weekly">, number> = { monthly: 1, quarterly: 3, yearly: 12 };

/** `numerator / denominator` rounded half-up, for positive amounts. */
function divideHalfUp(numerator: bigint, denominator: bigint): bigint {
  return (numerator * 2n + denominator) / (denominator * 2n);
}

/** Spec §7.5: what a plan costs per month — ×52/12, ×1, ÷3, ÷12 — half-up to the cent. */
export function monthlyEquivalent(price: Cents, cycle: Cycle): Cents {
  switch (cycle) {
    case "weekly":
      return divideHalfUp(price * 52n, 12n);
    case "monthly":
      return price;
    case "quarterly":
      return divideHalfUp(price, 3n);
    case "yearly":
      return divideHalfUp(price, 12n);
  }
}

/** Spec §7.5: what a plan costs per year — ×52, ×12, ×4, ×1. */
export function yearlyEquivalent(price: Cents, cycle: Cycle): Cents {
  return price * { weekly: 52n, monthly: 12n, quarterly: 4n, yearly: 1n }[cycle];
}

function parts(date: CivilDate): [number, number, number] {
  const [year, month, day] = date.split("-").map(Number);
  return [year, month, day];
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/**
 * The anchor moved by `count` cycles (negative goes back). A month-based cycle keeps the anchor's
 * own day, falling back to the last day of a shorter month, so a charge on the 31st is on the 28th
 * in February and back on the 31st in March.
 */
export function addCycles(anchor: CivilDate, cycle: Cycle, count: number): CivilDate {
  if (cycle === "weekly") return addDays(anchor, 7 * count);
  const [year, month, day] = parts(anchor);
  const index = year * 12 + (month - 1) + count * MONTHS_PER_CYCLE[cycle];
  const first = `${Math.floor(index / 12)}-${pad((index % 12) + 1)}-01`;
  const last = Number(lastDayOfMonth(first).slice(8));
  return `${first.slice(0, 8)}${pad(Math.min(day, last))}`;
}

function dayNumber(date: CivilDate): number {
  const [year, month, day] = parts(date);
  return Date.UTC(year, month - 1, day) / 86_400_000;
}

/** How many cycles from the anchor to the first charge on or after `date`. */
function firstIndexFrom(anchor: CivilDate, cycle: Cycle, date: CivilDate): number {
  const length = cycle === "weekly" ? 7 : MONTHS_PER_CYCLE[cycle] * 30.4;
  let index = Math.floor((dayNumber(date) - dayNumber(anchor)) / length) - 1;
  while (addCycles(anchor, cycle, index) < date) index += 1;
  while (addCycles(anchor, cycle, index - 1) >= date) index -= 1;
  return index;
}

/** Every charge of the calendar between `from` and `to`, both included, in order. */
export function dueDates(anchor: CivilDate, cycle: Cycle, from: CivilDate, to: CivilDate): CivilDate[] {
  const dates: CivilDate[] = [];
  for (let index = firstIndexFrom(anchor, cycle, from); ; index += 1) {
    const due = addCycles(anchor, cycle, index);
    if (due > to) return dates;
    dates.push(due);
  }
}

/**
 * The window a charge is looked for in — the "period" of spec §7.5 (plan F3 §3.4.3): the calendar
 * month of the charge for a monthly, quarterly or yearly plan (the design's "any day of the month",
 * "the renewal month"), three days either side of it for a weekly one.
 */
export function periodOf(due: CivilDate, cycle: Cycle): { from: CivilDate; to: CivilDate } {
  if (cycle === "weekly") return { from: addDays(due, -WEEKLY_REACH), to: addDays(due, WEEKLY_REACH) };
  const month = monthKey(due);
  return { from: month, to: lastDayOfMonth(month) };
}

/** The next charge on or after `today` whose period is not already paid (plan F3 §3.6.5). */
export function nextCharge(
  anchor: CivilDate,
  cycle: Cycle,
  today: CivilDate,
  paid: ReadonlySet<CivilDate>,
): CivilDate {
  for (let index = firstIndexFrom(anchor, cycle, today); ; index += 1) {
    const due = addCycles(anchor, cycle, index);
    if (!paid.has(due)) return due;
  }
}

const PARTS_PER_UNIT = 1_000_000n;

/**
 * When in its cycle a subscription falls due — the unit that identifies the moment, which is not
 * the same unit for every cycle (owner, 2026-09-21).
 *
 * A monthly subscription is "the 15th": the month is every month, so only the day says anything.
 * A quarterly one is "Q3": the day inside the quarter is detail, the quarter is the news. A yearly
 * one is "September". A weekly one is a weekday. The exact date is still there — the cell carries
 * it as its title — but the column says the thing a person is actually scanning for.
 */
export type DueMoment =
  | { kind: "weekday"; weekday: number }
  | { kind: "day"; day: number }
  | { kind: "quarter"; quarter: 1 | 2 | 3 | 4 }
  | { kind: "month"; month: number };

export function dueMoment(cycle: Cycle, on: CivilDate): DueMoment {
  const [, month, day] = on.split("-").map(Number);
  switch (cycle) {
    case "weekly":
      return { kind: "weekday", weekday: dayOfWeek(on) };
    case "monthly":
      return { kind: "day", day };
    case "quarterly":
      return { kind: "quarter", quarter: (Math.floor((month - 1) / 3) + 1) as 1 | 2 | 3 | 4 };
    case "yearly":
      return { kind: "month", month };
  }
}

/** A stored `numeric(10,6)` fraction as millionths, read from its text: no float on the way. */
export function toleranceParts(fraction: string): bigint {
  const [whole, decimals = ""] = fraction.trim().split(".");
  return BigInt(whole || "0") * PARTS_PER_UNIT + BigInt((decimals + "000000").slice(0, 6));
}

/** Whether a charge is within the tolerance of the expected amount: `|a − e| ≤ e × tolerance`. */
export function withinTolerance(actual: Cents, expected: Cents, tolerance: string): boolean {
  const difference = actual > expected ? actual - expected : expected - actual;
  return difference * PARTS_PER_UNIT <= expected * toleranceParts(tolerance);
}

/** A subscription as the payment check needs it. */
export interface CheckedSubscription {
  id: string;
  priceCents: Cents;
  cycle: Cycle;
  anchor: CivilDate;
  paymentAccountId: string | null;
  payeeMatch: string;
  tolerance: string;
  /** The civil day the subscription was created: the check starts with the period under way then. */
  createdOn: CivilDate;
  /** The expected amount of the periods already written, which a later price does not rewrite. */
  expected: ReadonlyMap<CivilDate, Cents>;
}

export interface Candidate {
  id: string;
  accountId: string;
  on: CivilDate;
  /** Positive. */
  cents: Cents;
  payee: string | null;
}

export interface PlannedCharge {
  subscriptionId: string;
  dueOn: CivilDate;
  periodFrom: CivilDate;
  periodTo: CivilDate;
  transactionId: string | null;
  expectedCents: Cents;
  actualCents: Cents | null;
  state: ChargeState;
}

/**
 * The payment check of spec §7.5 (plan F3 §3.4.4), for every period of every subscription given:
 * the charges from the period under way when the subscription was created up to a week from today,
 * at most the latest {@link MAX_CHECKED_PERIODS}.
 *
 * A period is paid by a movement in its window, on the paying account (any account when none is
 * set), whose payee contains the match text — both without spaces or case. Among several, the
 * amount closest to the expected one wins, then the date closest to the charge, then the id. A
 * movement pays one charge only, across subscriptions, taken in date order and then by
 * subscription id, so the answer never depends on the order the rows came in.
 *
 * Found within the tolerance → `paid`; found outside it → `amount_differs`; not found while the
 * window is open → `due` (the charge is at most seven days away by construction); not found once
 * the window has closed → `not_found`.
 */
export function planCharges(
  subscriptions: readonly CheckedSubscription[],
  candidates: readonly Candidate[],
  today: CivilDate,
): PlannedCharge[] {
  const horizon = addDays(today, DUE_WITHIN_DAYS);
  const slots = subscriptions.flatMap((subscription) => {
    const start = addCycles(subscription.createdOn, subscription.cycle, -1);
    // From the period under way when the subscription was created: one paid earlier that month
    // shows as paid, and a yearly plan added today is not held to last year's renewal.
    const dues = dueDates(subscription.anchor, subscription.cycle, start, horizon)
      .filter((due) => periodOf(due, subscription.cycle).to >= subscription.createdOn)
      .slice(-MAX_CHECKED_PERIODS);
    return dues.map((dueOn) => ({ subscription, dueOn, period: periodOf(dueOn, subscription.cycle) }));
  });
  slots.sort((a, b) =>
    a.dueOn < b.dueOn ? -1 : a.dueOn > b.dueOn ? 1 : a.subscription.id < b.subscription.id ? -1 : 1,
  );

  const taken = new Set<string>();
  const planned = slots.map(({ subscription, dueOn, period }): PlannedCharge & { claimed: boolean } => {
    const expectedCents = subscription.expected.get(dueOn) ?? subscription.priceCents;
    const needle = payeeKeyOf(subscription.payeeMatch) ?? "";
    const found = candidates
      .filter(
        (candidate) =>
          !taken.has(candidate.id) &&
          candidate.on >= period.from &&
          candidate.on <= period.to &&
          (subscription.paymentAccountId === null || candidate.accountId === subscription.paymentAccountId) &&
          needle !== "" &&
          (payeeKeyOf(candidate.payee) ?? "").includes(needle),
      )
      .sort((a, b) => {
        const byAmount = Number(
          (a.cents > expectedCents ? a.cents - expectedCents : expectedCents - a.cents) -
            (b.cents > expectedCents ? b.cents - expectedCents : expectedCents - b.cents),
        );
        const byDate =
          Math.abs(dayNumber(a.on) - dayNumber(dueOn)) - Math.abs(dayNumber(b.on) - dayNumber(dueOn));
        return byAmount || byDate || (a.id < b.id ? -1 : 1);
      })[0];
    if (found) taken.add(found.id);
    const state: ChargeState = found
      ? withinTolerance(found.cents, expectedCents, subscription.tolerance)
        ? "paid"
        : "amount_differs"
      : period.to < today
        ? "not_found"
        : "due";
    return {
      subscriptionId: subscription.id,
      dueOn,
      periodFrom: period.from,
      periodTo: period.to,
      transactionId: found?.id ?? null,
      expectedCents,
      actualCents: found?.cents ?? null,
      state,
      // A charge whose day fell before the subscription existed here is a *look-back*, not a
      // claim: worth checking, because the person may well have paid it days before adding the
      // plan, but never worth announcing as owed. Nobody can be behind on a charge from before
      // they said the subscription existed.
      //
      // The anchor is the exception, and it is the person's own words: "the next charge is the
      // 2nd" names that charge, even when they say it on the 20th. So that one is always claimed.
      claimed: dueOn >= subscription.createdOn || dueOn === subscription.anchor,
    };
  });
  return (
    planned
      // Reported 2026-09-21: a rental added on 21 September with its next charge on 15 October
      // announced "expected on 15 Sep 2026 · not found yet" — September's charge, invented by the
      // look-back and then held against a plan that had never been asked about it. The look-back
      // stays, because a charge paid earlier in the month one adds a subscription should still show
      // as paid; what goes is the accusation when it finds nothing.
      .filter((charge) => charge.claimed || charge.transactionId !== null)
      .map(({ claimed, ...charge }) => {
        void claimed;
        return charge;
      })
      .sort((a, b) =>
        a.subscriptionId < b.subscriptionId
          ? -1
          : a.subscriptionId > b.subscriptionId
            ? 1
            : a.dueOn < b.dueOn
              ? -1
              : 1,
      )
  );
}

/** The subscription cycle of a detected interval; biweekly and anything else has none. */
export function cadenceOf(intervalDays: number): Cycle | null {
  const band = RECURRENCE_BANDS.find((one) => intervalDays >= one.min && intervalDays <= one.max);
  if (!band || band.cadence === "biweekly") return null;
  return band.cadence;
}

export interface Suggestion {
  payeeKey: string;
  name: string;
  payeeMatch: string;
  priceCents: Cents;
  cycle: Cycle;
  nextChargeOn: CivilDate;
  accountId: string;
  categoryId: string | null;
  occurrences: number;
}

/**
 * "Suggest from recurring payments" (spec §7.5, plan F3 §3.4.7): the outgoing recurring patterns
 * with a subscription cycle that no subscription, in any state, covers yet — covered meaning its
 * match text (without spaces or case) is inside the pattern's payee key.
 */
export function suggestionsFrom(
  patterns: readonly {
    payeeKey: string;
    sign: number;
    intervalDays: number;
    medianCents: Cents;
    nextExpectedOn: CivilDate;
    occurrences: number;
  }[],
  samples: ReadonlyMap<string, { payee: string; accountId: string; categoryId: string | null }>,
  subscriptions: readonly { payeeMatch: string | null }[],
): Suggestion[] {
  const needles = subscriptions.flatMap((subscription) => {
    const key = payeeKeyOf(subscription.payeeMatch);
    return key === null ? [] : [key];
  });
  return patterns
    .flatMap((pattern) => {
      const cycle = cadenceOf(pattern.intervalDays);
      const sample = samples.get(pattern.payeeKey);
      if (pattern.sign >= 0 || cycle === null || !sample) return [];
      if (needles.some((needle) => pattern.payeeKey.includes(needle))) return [];
      return [
        {
          payeeKey: pattern.payeeKey,
          name: sample.payee,
          payeeMatch: sample.payee,
          priceCents: pattern.medianCents < 0n ? -pattern.medianCents : pattern.medianCents,
          cycle,
          nextChargeOn: pattern.nextExpectedOn,
          accountId: sample.accountId,
          categoryId: sample.categoryId,
          occurrences: pattern.occurrences,
        },
      ];
    })
    .sort((a, b) => a.name.localeCompare(b.name) || a.payeeKey.localeCompare(b.payeeKey));
}

const civilDate = z.string().refine(isCivilDate, "Not a civil date");
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => (value === "" ? null : value))
    .nullable()
    .default(null);

export const subscriptionInputSchema = z.object({
  name: z.string().trim().min(1).max(80),
  categoryId: z.uuid().nullable().default(null),
  utility: z.number().int().min(1).max(10).default(5),
  priceCents: z.bigint().positive(),
  cycle: z.enum(CYCLES),
  nextChargeOn: civilDate,
  paymentAccountId: z.uuid().nullable().default(null),
  payeeMatch: optionalText(80),
  /** A fraction as text, e.g. "0.05": the database's `numeric`, never a float. */
  tolerance: z
    .string()
    .regex(/^(0(\.\d{1,6})?|1(\.0{1,6})?)$/)
    .default("0.05"),
});

export type SubscriptionInput = z.input<typeof subscriptionInputSchema>;
