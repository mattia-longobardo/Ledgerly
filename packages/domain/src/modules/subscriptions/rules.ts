import { z } from "zod";
import { cadenceOfInterval, payeeKeyOf } from "../transactions/rules";
import { addDays, type CivilDate, dayOfWeek, lastDayOfMonth, monthKey } from "../../shared/dates";
import type { Cents } from "../../shared/money";
import { divRound, percentToFraction } from "../../shared/money";
import { dayNumber } from "../../shared/dates";
import { civilDate, optionalText } from "../../shared/inputs";

export const CYCLES = ["weekly", "monthly", "quarterly", "yearly"] as const;
export const SUBSCRIPTION_STATES = ["active", "paused", "cancelled"] as const;
export const CHARGE_STATES = ["paid", "amount_differs", "due", "not_found"] as const;

/** The currency of every price (the schema holds it to EUR): what a projection is worked out in. */
export const PRICE_CURRENCY = "EUR";

export type Cycle = (typeof CYCLES)[number];
export type SubscriptionState = (typeof SUBSCRIPTION_STATES)[number];
type ChargeState = (typeof CHARGE_STATES)[number];

/** Utility at or below this is "low" (spec §7.5). */
export const LOW_UTILITY = 5;
/** A charge not found yet is `due` from this many days before its date (spec §7.5). */
const DUE_WITHIN_DAYS = 7;
/** How many periods back the check keeps, at most. */
const MAX_CHECKED_PERIODS = 24;
/** Half the span of a weekly charge's window, in days: a week split around its date. */
const WEEKLY_REACH = 3;

/** The units of «every N weeks or months» (R5a, ST-15) and the largest N of each (D4). */
export const EVERY_UNITS = ["week", "month"] as const;
export const MAX_EVERY: Record<(typeof EVERY_UNITS)[number], number> = { week: 12, month: 24 };

/** «Every N weeks or months»: what a cycle of the list is, and what it may also be since R5a. */
export interface Every {
  unit: (typeof EVERY_UNITS)[number];
  count: number;
}

/** How often a subscription falls due: one of the 4 cycles, or every N weeks or months. */
export type Frequency = Cycle | Every;

const EVERY_OF_CYCLE: Record<Cycle, Every> = {
  weekly: { unit: "week", count: 1 },
  monthly: { unit: "month", count: 1 },
  quarterly: { unit: "month", count: 3 },
  yearly: { unit: "month", count: 12 },
};

/** A frequency as weeks or months. */
export function everyOf(frequency: Frequency): Every {
  return typeof frequency === "string" ? EVERY_OF_CYCLE[frequency] : frequency;
}

/** The cycle of the list a frequency is, or null when it is none of the 4. */
export function cycleOf(frequency: Frequency): Cycle | null {
  const every = everyOf(frequency);
  return (
    CYCLES.find(
      (cycle) => EVERY_OF_CYCLE[cycle].unit === every.unit && EVERY_OF_CYCLE[cycle].count === every.count,
    ) ?? null
  );
}

/**
 * The cycle of the list nearest to a frequency: what the `cycle` column keeps for a frequency that
 * is none of the 4, so an image before R5a still reads a cycle it knows.
 */
export function nearestCycle(frequency: Frequency): Cycle {
  const every = everyOf(frequency);
  if (every.unit === "week") return "weekly";
  return every.count < 3 ? "monthly" : every.count < 12 ? "quarterly" : "yearly";
}

/** A stored row's frequency: its «every» when it has one, its cycle otherwise. */
export function frequencyOf(row: {
  cycle: Cycle;
  everyUnit: string | null;
  everyCount: number | null;
}): Frequency {
  return row.everyUnit !== null && row.everyCount !== null
    ? { unit: row.everyUnit === "week" ? "week" : "month", count: row.everyCount }
    : row.cycle;
}

/** The columns of a frequency: a cycle of the list alone, or the nearest cycle and the «every». */
export function frequencyColumns(cycle: Cycle, every: Every | null) {
  if (every === null) return { cycle, everyUnit: null, everyCount: null };
  const exact = cycleOf(every);
  return exact !== null
    ? { cycle: exact, everyUnit: null, everyCount: null }
    : { cycle: nearestCycle(every), everyUnit: every.unit, everyCount: every.count };
}

/** Spec §7.5: what a plan costs per month — ×52/12, ×1, ÷3, ÷12; every N: ÷N — half-up to the cent. */
export function monthlyEquivalent(price: Cents, frequency: Frequency): Cents {
  const { unit, count } = everyOf(frequency);
  return unit === "week" ? divRound(price * 52n, 12n * BigInt(count)) : divRound(price, BigInt(count));
}

/** Spec §7.5: what a plan costs per year — ×52, ×12, ×4, ×1; every N: ÷N, half-up to the cent. */
export function yearlyEquivalent(price: Cents, frequency: Frequency): Cents {
  const { unit, count } = everyOf(frequency);
  return divRound(price * (unit === "week" ? 52n : 12n), BigInt(count));
}

/** What some plans cost per month together (SUB-3: the page's total and an account's row alike). */
export function monthlyCost(plans: readonly { priceCents: Cents; cycle: Frequency }[]): Cents {
  return plans.reduce<Cents>((sum, plan) => sum + monthlyEquivalent(plan.priceCents, plan.cycle), 0n);
}

/**
 * The charges already found (`paid` or `amount_differs`), by subscription: the one set the next
 * charge, "Next 30 days" and the projections all skip (SUB-2: computed once per read).
 */
export function foundCharges(
  charges: readonly { subscriptionId: string; dueOn: CivilDate; state: ChargeState }[],
): Map<string, Set<CivilDate>> {
  const found = new Map<string, Set<CivilDate>>();
  for (const charge of charges) {
    if (charge.state !== "paid" && charge.state !== "amount_differs") continue;
    const days = found.get(charge.subscriptionId) ?? new Set<CivilDate>();
    days.add(charge.dueOn);
    found.set(charge.subscriptionId, days);
  }
  return found;
}

/**
 * The charges of some plans due in `[from, to]` that have not been found yet (SUB-1: one list
 * under "Next 30 days" and under every projection).
 */
export function upcomingCharges<
  P extends { id: string; priceCents: Cents; cycle: Frequency; anchor: CivilDate },
>(
  plans: readonly P[],
  found: ReadonlyMap<string, ReadonlySet<CivilDate>>,
  from: CivilDate,
  to: CivilDate,
): { plan: P; dueOn: CivilDate }[] {
  return plans.flatMap((plan) =>
    dueDates(plan.anchor, plan.cycle, from, to)
      .filter((due) => !found.get(plan.id)?.has(due))
      .map((dueOn) => ({ plan, dueOn })),
  );
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
export function addCycles(anchor: CivilDate, cycle: Frequency, count: number): CivilDate {
  const every = everyOf(cycle);
  if (every.unit === "week") return addDays(anchor, 7 * every.count * count);
  const [year, month, day] = parts(anchor);
  const index = year * 12 + (month - 1) + count * every.count;
  const first = `${Math.floor(index / 12)}-${pad((index % 12) + 1)}-01`;
  const last = Number(lastDayOfMonth(first).slice(8));
  return `${first.slice(0, 8)}${pad(Math.min(day, last))}`;
}

/** How many cycles from the anchor to the first charge on or after `date`. */
function firstIndexFrom(anchor: CivilDate, cycle: Frequency, date: CivilDate): number {
  const every = everyOf(cycle);
  const length = every.unit === "week" ? 7 * every.count : every.count * 30.4;
  let index = Math.floor((dayNumber(date) - dayNumber(anchor)) / length) - 1;
  while (addCycles(anchor, cycle, index) < date) index += 1;
  while (addCycles(anchor, cycle, index - 1) >= date) index -= 1;
  return index;
}

/** Every charge of the calendar between `from` and `to`, both included, in order. */
export function dueDates(anchor: CivilDate, cycle: Frequency, from: CivilDate, to: CivilDate): CivilDate[] {
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
export function periodOf(due: CivilDate, cycle: Frequency): { from: CivilDate; to: CivilDate } {
  if (everyOf(cycle).unit === "week")
    return { from: addDays(due, -WEEKLY_REACH), to: addDays(due, WEEKLY_REACH) };
  const month = monthKey(due);
  return { from: month, to: lastDayOfMonth(month) };
}

/** The next charge on or after `today` whose period is not already paid (plan F3 §3.6.5). */
export function nextCharge(
  anchor: CivilDate,
  cycle: Frequency,
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

export function dueMoment(cycle: Frequency, on: CivilDate): DueMoment {
  const [, month, day] = on.split("-").map(Number);
  const every = everyOf(cycle);
  // Every N weeks is a weekday; every 1 or 2 months a day, 3 a quarter, 4 or more a month.
  if (every.unit === "week") return { kind: "weekday", weekday: dayOfWeek(on) };
  if (every.count < 3) return { kind: "day", day };
  if (every.count === 3)
    return { kind: "quarter", quarter: (Math.floor((month - 1) / 3) + 1) as 1 | 2 | 3 | 4 };
  return { kind: "month", month };
}

/**
 * The part of a balance the subscriptions commit, as a percentage with one decimal, truncated:
 * `⌊commit × 1000 / balance⌋ / 10`. Null without a balance, or with one at or below zero.
 */
export function commitPercent(commit: Cents, balance: Cents | null): number | null {
  return balance !== null && balance > 0n ? Number((commit * 1000n) / balance) / 10 : null;
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
  cycle: Frequency;
  anchor: CivilDate;
  paymentAccountId: string | null;
  payeeMatch: string;
  tolerance: string;
  /** The civil day the subscription was created: the check starts with the period under way then. */
  createdOn: CivilDate;
  /** The expected amount of the periods already written, which a later price does not rewrite. */
  expected: ReadonlyMap<CivilDate, Cents>;
}

interface Candidate {
  id: string;
  accountId: string;
  on: CivilDate;
  /** Positive. */
  cents: Cents;
  payee: string | null;
  /**
   * The bank's own text. A direct debit prints its creditor and its mandate number there and
   * leaves the payee to whatever the bank calls the counterpart, so a subscription paid by SDD is
   * recognisable only here (reported 2026-09-21). The funds module has read both since F4.
   */
  note: string | null;
}

interface PlannedCharge {
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
 * The text a subscription's match is looked for in: the payee and the bank's own description,
 * together, normalised the way §7.2 normalises a payee — no spaces, no case.
 *
 * Both, because the field is labelled "the expense description contains" in both languages and a
 * direct debit puts the only recognisable thing it has — the mandate number — in the description.
 * Reading only the payee made that promise false for every SDD (reported 2026-09-21).
 */
function matchKeyOf(candidate: Candidate): string {
  return payeeKeyOf(`${candidate.payee ?? ""} ${candidate.note ?? ""}`) ?? "";
}

/** Every period to check, in date order and then by subscription id. */
function slotsOf(subscriptions: readonly CheckedSubscription[], today: CivilDate) {
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
  return slots.sort((a, b) =>
    a.dueOn < b.dueOn ? -1 : a.dueOn > b.dueOn ? 1 : a.subscription.id < b.subscription.id ? -1 : 1,
  );
}

/**
 * The movement that pays one period, among those no earlier period took: in its window, on the
 * paying account, matching the text; the amount closest to the expected one wins, then the date.
 */
function bestMatch(
  slot: {
    subscription: CheckedSubscription;
    dueOn: CivilDate;
    period: { from: CivilDate; to: CivilDate };
    expectedCents: Cents;
  },
  candidates: readonly Candidate[],
  taken: ReadonlySet<string>,
): Candidate | undefined {
  const { subscription, dueOn, period, expectedCents } = slot;
  const needle = payeeKeyOf(subscription.payeeMatch) ?? "";
  return candidates
    .filter(
      (candidate) =>
        !taken.has(candidate.id) &&
        candidate.on >= period.from &&
        candidate.on <= period.to &&
        (subscription.paymentAccountId === null || candidate.accountId === subscription.paymentAccountId) &&
        needle !== "" &&
        matchKeyOf(candidate).includes(needle),
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
}

/**
 * The payment check of spec §7.5 (plan F3 §3.4.4), for every period of every subscription given:
 * the charges from the period under way when the subscription was created up to a week from today,
 * at most the latest {@link MAX_CHECKED_PERIODS}.
 *
 * A period is paid by a movement in its window, on the paying account (any account when none is
 * set), whose payee **or description** contains the match text — all without spaces or case. Among several, the
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
  const slots = slotsOf(subscriptions, today);

  const taken = new Set<string>();
  const planned = slots.map(({ subscription, dueOn, period }): PlannedCharge & { claimed: boolean } => {
    const expectedCents = subscription.expected.get(dueOn) ?? subscription.priceCents;
    const found = bestMatch({ subscription, dueOn, period, expectedCents }, candidates, taken);
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
  const cadence = cadenceOfInterval(intervalDays);
  return cadence === "biweekly" ? null : cadence;
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

/**
 * A tolerance typed as a percentage in plain decimal form ("5", "2.5") as the stored fraction
 * ("0.050000"), 0 to 100 % (SUB-7: the conversion is the domain's, not the form's). Empty is 5 %.
 */
export function toleranceOf(percent: string | undefined): string {
  const plain = percent === undefined || percent.trim() === "" ? "5" : percent;
  const fraction = percentToFraction(plain);
  if (toleranceParts(fraction) > PARTS_PER_UNIT) throw new RangeError("Tolerance out of range");
  return fraction;
}

export const subscriptionInputSchema = z.object({
  name: z.string().trim().min(1).max(80),
  categoryId: z.uuid().nullable().default(null),
  // Optional since R5a (ST-15): null is «no vote»; left out, the 5 of before.
  utility: z.number().int().min(1).max(10).nullable().default(5),
  priceCents: z.bigint().positive(),
  cycle: z.enum(CYCLES),
  /** «Every N weeks or months» (R5a, D4): when given, it is the frequency and `cycle` is its nearest. */
  every: z
    .object({ unit: z.enum(EVERY_UNITS), count: z.number().int().min(1) })
    .refine((every) => every.count <= MAX_EVERY[every.unit], "Too many weeks or months")
    .nullable()
    // Left out: none for a new subscription; for a change, the one it has while `cycle` stays.
    .optional(),
  nextChargeOn: civilDate(),
  paymentAccountId: z.uuid().nullable().default(null),
  payeeMatch: optionalText(80),
  /** A fraction as text, e.g. "0.05": the database's `numeric`, never a float. */
  tolerance: z
    .string()
    .regex(/^(0(\.\d{1,6})?|1(\.0{1,6})?)$/)
    .default("0.05"),
});

export type SubscriptionInput = z.input<typeof subscriptionInputSchema>;
