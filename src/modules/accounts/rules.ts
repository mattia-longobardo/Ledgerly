import { z } from "zod";
import {
  addMonths,
  type CivilDate,
  isCivilDate,
  lastDayOfMonth,
  type MonthKey,
  monthKey,
  monthsApart,
} from "@/platform/dates";
import type { NumberFormat } from "@/platform/format";
import { type Cents, parseCents, sumCents } from "@/platform/money";

export const ACCOUNT_TYPES = [
  "checking",
  "savings",
  "cash",
  "investment",
  "pension",
  "crypto",
  "credit",
  "other",
] as const;
export const ACCOUNT_STATES = ["active", "unavailable", "archived"] as const;
export const ACCOUNT_ORIGINS = ["manual", "synced"] as const;
/**
 * `derived` (F2.5) is a month end rebuilt from the movements (`deriveMonthEnds`): it loses to every
 * other source, and is rewritten from scratch whenever the readings or the movements change.
 */
export const BALANCE_SOURCES = ["manual", "provider", "system", "import", "derived"] as const;
export const REMINDERS = ["monthly", "quarterly", "never"] as const;
export const TRENDS = ["hold", "interpolate"] as const;
export const SNAPSHOT_STATES = ["success", "warning", "failed"] as const;

export type AccountType = (typeof ACCOUNT_TYPES)[number];
export type AccountState = (typeof ACCOUNT_STATES)[number];
export type AccountOrigin = (typeof ACCOUNT_ORIGINS)[number];
export type BalanceSource = (typeof BALANCE_SOURCES)[number];
export type Reminder = (typeof REMINDERS)[number];
export type Trend = (typeof TRENDS)[number];

/** The one obsolescence constant (spec §7.1): a synced account older than this is stale. */
export const DEFAULT_STALE_AFTER_HOURS = 36;

/** Overview groups accounts into KPI tiles by type, with "counts as liquid" overriding the type. */
export type Bucket = "cash" | "savings" | "investments" | "other";

const BUCKET_BY_TYPE: Record<AccountType, Bucket> = {
  checking: "cash",
  cash: "cash",
  credit: "cash",
  savings: "savings",
  investment: "investments",
  pension: "investments",
  crypto: "investments",
  other: "other",
};

export function bucketOf(account: { type: AccountType; countsAsLiquid: boolean }): Bucket {
  const natural = BUCKET_BY_TYPE[account.type];
  if (!account.countsAsLiquid) return natural;
  return natural === "investments" || natural === "other" ? "cash" : natural;
}

const HEX_COLOR = /^#[0-9a-f]{6}$/i;
const CURRENCY = /^[A-Z]{3}$/;

const civilDate = z.string().refine(isCivilDate, "Not a civil date");
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => (value === "" ? null : value))
    .nullable()
    .default(null);

/** Amounts arrive from forms as plain decimal strings and live as cents from here on. */
const cents = z.bigint();

export const accountCreateSchema = z.object({
  name: z.string().trim().min(1).max(80),
  type: z.enum(ACCOUNT_TYPES),
  currency: z.string().regex(CURRENCY).default("EUR"),
  groupId: z.uuid().nullable().default(null),
  color: z.string().regex(HEX_COLOR).nullable().default(null),
  reference: optionalText(64),
  purpose: optionalText(120),
  openedOn: civilDate.nullable().default(null),
  notes: optionalText(2000),
  openingBalance: z.object({ on: civilDate, cents }).nullable().default(null),
});
export type AccountCreateInput = z.infer<typeof accountCreateSchema>;

export const accountSettingsSchema = z.object({
  name: z.string().trim().min(1).max(80),
  type: z.enum(ACCOUNT_TYPES),
  currency: z.string().regex(CURRENCY),
  groupId: z.uuid().nullable().default(null),
  color: z.string().regex(HEX_COLOR).nullable().default(null),
  reference: optionalText(64),
  purpose: optionalText(120),
  openedOn: civilDate.nullable().default(null),
  notes: optionalText(2000),
  inNetWorth: z.boolean(),
  inSnapshot: z.boolean(),
  countsAsLiquid: z.boolean(),
  lowBalanceCents: cents.min(0n).nullable().default(null),
  staleAfterHours: z.number().int().min(1).max(8760).default(DEFAULT_STALE_AFTER_HOURS),
  reminder: z.enum(REMINDERS),
  betweenEntries: z.enum(TRENDS),
});
export type AccountSettingsInput = z.infer<typeof accountSettingsSchema>;

export const balanceEntrySchema = z.object({
  on: civilDate,
  cents,
  availableCents: cents.nullable().default(null),
  note: optionalText(200),
});
export type BalanceEntryInput = z.infer<typeof balanceEntrySchema>;

/**
 * A synced account keeps the type and the currency the provider gave it (spec §7.1); only the
 * fields a person owns may be edited. Applied here, not only hidden in the form.
 */
export function settingsForSynced(
  input: AccountSettingsInput,
  current: { type: AccountType; currency: string },
): AccountSettingsInput {
  return { ...input, type: current.type, currency: current.currency };
}

/** Manual balances are never in the future: "today" is the user's own civil date. */
export function isFutureDate(on: CivilDate, today: CivilDate): boolean {
  return on > today;
}

export function isStale(lastSyncedAt: Date | null, staleAfterHours: number, now: Date = new Date()): boolean {
  if (lastSyncedAt === null) return true;
  return now.getTime() - lastSyncedAt.getTime() > staleAfterHours * 3_600_000;
}

export interface BalancePoint {
  on: CivilDate;
  cents: Cents;
  /** Rebuilt from the movements rather than read (F2.5): the charts draw it dashed. */
  derived?: boolean;
}

/** One day's net of an account's movements, as `dailyNetByAccount` gives it. */
export interface DailyNet {
  on: CivilDate;
  cents: Cents;
}

/**
 * The month ends of a synced account rebuilt from its movements (spec §7.1, F2.5).
 *
 * A month that holds **any** reading gets nothing: `monthlyPoints` takes a month's latest day
 * before its source, so a derived point on the 31st would beat a real reading of the 20th. Every
 * other month end between the month before the first movement and the latest reading gets the
 * nearest reading **after** it, minus what moved in between — so a gap between two readings is
 * filled too, and each value leans on the closest thing actually known. Before the month of the
 * first movement nothing is known about the history, and nothing is written.
 *
 * `observed` must hold one reading per day at most (the best source of that day); `daily` is sorted
 * by day. A day's movements count up to and including the reading of that day, which is how a
 * balance read today already contains today's movements.
 */
export function deriveMonthEnds(
  observed: readonly BalancePoint[],
  daily: readonly DailyNet[],
): BalancePoint[] {
  if (observed.length === 0 || daily.length === 0) return [];
  const readings = [...observed].sort((a, b) => (a.on < b.on ? -1 : a.on > b.on ? 1 : 0));
  const readMonths = new Set(readings.map((reading) => monthKey(reading.on)));
  const latest = readings[readings.length - 1].on;

  const movedThrough = movementsThrough(daily);

  const derived: BalancePoint[] = [];
  for (
    let month = addMonths(monthKey(daily[0].on), -1);
    lastDayOfMonth(month) < latest;
    month = addMonths(month, 1)
  ) {
    if (readMonths.has(month)) continue;
    const end = lastDayOfMonth(month);
    const next = readings.find((reading) => reading.on > end);
    if (!next) break;
    derived.push({ on: end, cents: next.cents - (movedThrough(next.on) - movedThrough(end)), derived: true });
  }
  return derived;
}

/**
 * Everything an account moved on or before a day, from its daily nets (sorted by day): prefix sums
 * and a binary search, so "what moved in (a, b]" is one subtraction whatever the history's length.
 */
function movementsThrough(daily: readonly DailyNet[]): (on: CivilDate) => Cents {
  const cumulative: Cents[] = [];
  let running = 0n;
  for (const day of daily) {
    running += day.cents;
    cumulative.push(running);
  }
  return (on) => {
    let low = 0;
    let high = daily.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (daily[middle].on <= on) low = middle + 1;
      else high = middle;
    }
    return low === 0 ? 0n : cumulative[low - 1];
  };
}

/**
 * An account's balance on each of `days` (F2.5), for Account detail's day grain.
 *
 * `movements` (a synced account): the nearest reading on or after the day, minus what moved in
 * between — so a reading, or a correction typed by hand, is never walked over — and past the latest
 * reading, that reading plus what moved since. Days before the first reading are rebuilt and flagged
 * `estimated`, like the month ends of `deriveMonthEnds`, and nothing is rebuilt before the month the
 * first movement falls in. `hold` (a manual account, or one with no movements): the last entry
 * carries until the next, and a day before the first one is unknown.
 *
 * `readings` holds one value per day at most; `daily` is sorted by day.
 */
export function dailySeries(
  readings: readonly BalancePoint[],
  daily: readonly DailyNet[],
  days: readonly CivilDate[],
  mode: "movements" | "hold",
): { values: (Cents | null)[]; estimated: boolean[] } {
  const sorted = [...readings].sort((a, b) => (a.on < b.on ? -1 : a.on > b.on ? 1 : 0));
  const held = (day: CivilDate): Cents | null => {
    let value: Cents | null = null;
    for (const reading of sorted) {
      if (reading.on > day) break;
      value = reading.cents;
    }
    return value;
  };
  if (mode === "hold" || daily.length === 0 || sorted.length === 0) {
    return { values: days.map(held), estimated: days.map(() => false) };
  }

  const movedThrough = movementsThrough(daily);
  const earliest = lastDayOfMonth(addMonths(monthKey(daily[0].on), -1));
  const first = sorted[0];
  const latest = sorted[sorted.length - 1];
  const values = days.map((day) => {
    if (day < earliest) return held(day);
    const next = sorted.find((reading) => reading.on >= day);
    if (next) return next.cents - (movedThrough(next.on) - movedThrough(day));
    return latest.cents + (movedThrough(day) - movedThrough(latest.on));
  });
  return { values, estimated: days.map((day, i) => values[i] !== null && day < first.on) };
}

/**
 * Which months of a chart stand on a derived point (F2.5), with the same carrying forward as
 * `monthEndSeries`: a month takes the flag of the point its value comes from. A month before the
 * first point is a gap in the series, and a gap is not an estimate.
 */
export function estimatedMonths(points: readonly BalancePoint[], months: readonly MonthKey[]): boolean[] {
  if (months.length === 0) return [];
  const first = months[0];
  const anchors = new Map<number, boolean>();
  for (const point of points) anchors.set(monthsApart(first, monthKey(point.on)), point.derived === true);
  const indexes = [...anchors.keys()].sort((a, b) => a - b);
  return months.map((_, i) => {
    let previous: number | null = null;
    for (const index of indexes) {
      if (index <= i) previous = index;
      else break;
    }
    return previous === null ? false : (anchors.get(previous) as boolean);
  });
}

function roundedBetween(from: Cents, to: Cents, step: number, span: number): Cents {
  const numerator = (to - from) * BigInt(step);
  const denominator = BigInt(span);
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  const half = remainder < 0n ? -remainder * 2n : remainder * 2n;
  const bump = half >= denominator ? (numerator < 0n ? -1n : 1n) : 0n;
  return from + quotient + bump;
}

/**
 * One value per month, each the account's last balance on or before that month's end.
 *
 * `points` must be sorted by date and may start before the window: the most recent earlier point
 * is the series' starting value (spec §7.1). A month before the very first point is `null`, never
 * zero. `hold` carries the last known value forward; `interpolate` draws a straight line between
 * two known months and is for charts only — totals always use `hold`.
 */
export function monthEndSeries(
  points: readonly BalancePoint[],
  months: readonly MonthKey[],
  trend: Trend = "hold",
): (Cents | null)[] {
  if (months.length === 0) return [];
  const first = months[0];
  const anchors = new Map<number, Cents>();
  for (const point of points) {
    anchors.set(monthsApart(first, monthKey(point.on)), point.cents);
  }
  const indexes = [...anchors.keys()].sort((a, b) => a - b);

  return months.map((_, i) => {
    let previous: number | null = null;
    let next: number | null = null;
    for (const index of indexes) {
      if (index <= i) previous = index;
      else {
        next = index;
        break;
      }
    }
    if (previous === null) return null;
    const from = anchors.get(previous) as Cents;
    if (trend === "hold" || next === null || previous === i) return from;
    return roundedBetween(from, anchors.get(next) as Cents, i - previous, next - previous);
  });
}

/**
 * The monthly total across accounts. A month is `null` only when every account is unknown there;
 * `partial` marks a total that is missing at least one account, so it is never shown as complete.
 */
export function totalSeries(
  series: readonly (readonly (Cents | null)[])[],
  length: number,
): { total: Cents | null; partial: boolean }[] {
  return Array.from({ length }, (_, i) => sumCents(series.map((one) => one[i] ?? null)));
}

export type AlertKind = "low_balance" | "stale_sync";

export interface AccountAlert {
  accountId: string;
  kind: AlertKind;
}

/**
 * The two account alerts of spec §7.1, each governed by that account's own settings. An archived
 * account is silent, and an account with no balance yet cannot be below its threshold.
 */
export function alertsFor(
  account: {
    id: string;
    state: AccountState;
    origin: AccountOrigin;
    lowBalanceCents: Cents | null;
    staleAfterHours: number;
    lastSyncedAt: Date | null;
  },
  latest: Cents | null,
  now: Date = new Date(),
): AccountAlert[] {
  if (account.state === "archived") return [];
  const alerts: AccountAlert[] = [];
  if (account.lowBalanceCents !== null && latest !== null && latest < account.lowBalanceCents) {
    alerts.push({ accountId: account.id, kind: "low_balance" });
  }
  // Not for an `unavailable` account: the provider has stopped returning it, so of course its
  // reading is old, and §7.1 forbids deleting it — the alert would never clear and says nothing
  // the state does not already say. "Stale" is for an account the provider still has and is not
  // sending.
  if (
    account.origin === "synced" &&
    account.state !== "unavailable" &&
    isStale(account.lastSyncedAt, account.staleAfterHours, now)
  ) {
    alerts.push({ accountId: account.id, kind: "stale_sync" });
  }
  return alerts;
}

/** An account is deletable only when nothing points at it and no provider owns it (spec §7.1). */
export function canDelete(account: { origin: AccountOrigin }, references: number): boolean {
  return account.origin === "manual" && references === 0;
}

export function normalizeName(name: string): string {
  return name.replace(/\s+/g, "").toLocaleLowerCase();
}

export interface LocalAccount {
  id: string;
  name: string;
  origin: AccountOrigin;
  state: AccountState;
  provider: string | null;
  providerAccountId: string | null;
  renamedLocally: boolean;
}

export interface RemoteAccount {
  provider: string;
  providerAccountId: string;
  name: string;
  type: AccountType;
  currency: string;
}

export type ReconcileStep =
  | { action: "create"; remote: RemoteAccount }
  | { action: "adopt"; id: string; remote: RemoteAccount }
  | { action: "rename"; id: string; name: string }
  | { action: "reappear"; id: string }
  | { action: "unavailable"; id: string };

/**
 * The lifecycle of a provider's accounts (spec §7.1), as a list of steps the service applies.
 *
 * A manual account with the same name is adopted once, comparing names without spaces or case; a
 * provider's rename is followed only while the local name has not been changed by hand; an account
 * archived locally stays archived; and an account the provider stopped sending becomes
 * `unavailable`, never deleted.
 */
export function reconcileProviderAccounts(
  local: readonly LocalAccount[],
  remote: readonly RemoteAccount[],
  provider: string,
): ReconcileStep[] {
  const steps: ReconcileStep[] = [];
  const mine = local.filter((account) => account.provider === null || account.provider === provider);
  const linked = new Map(
    mine
      .filter((account) => account.providerAccountId !== null)
      .map((account) => [account.providerAccountId as string, account]),
  );
  const adoptable = new Map<string, LocalAccount>();
  for (const account of mine) {
    if (account.origin !== "manual" || account.state === "archived") continue;
    // Two manual accounts can share a name: the first in the user's own order is adopted, so the
    // same input always produces the same outcome.
    const key = normalizeName(account.name);
    if (!adoptable.has(key)) adoptable.set(key, account);
  }

  const seen = new Set<string>();
  for (const incoming of remote) {
    if (incoming.provider !== provider) continue;
    seen.add(incoming.providerAccountId);
    const known = linked.get(incoming.providerAccountId);
    if (known) {
      if (known.state === "unavailable") steps.push({ action: "reappear", id: known.id });
      if (!known.renamedLocally && known.name !== incoming.name) {
        steps.push({ action: "rename", id: known.id, name: incoming.name });
      }
      continue;
    }
    const candidate = adoptable.get(normalizeName(incoming.name));
    if (candidate) {
      adoptable.delete(normalizeName(incoming.name));
      steps.push({ action: "adopt", id: candidate.id, remote: incoming });
      continue;
    }
    steps.push({ action: "create", remote: incoming });
  }

  for (const account of linked.values()) {
    if (seen.has(account.providerAccountId as string)) continue;
    if (account.state === "active") steps.push({ action: "unavailable", id: account.id });
  }
  return steps;
}

/**
 * An amount as a person types it, in their own number format (spec §8.5): "1.234,56", "1 234,56"
 * or "1,234.56", with or without a euro sign. Grouping and decimal separators are resolved by the
 * format rather than guessed, so "1.234" is one thousand in Italian and one point two in English.
 */
export function parseAmount(input: string, format: NumberFormat): Cents {
  const cleaned = input.replace(/[\s\u00a0\u202f€]/g, "").replace(/\u2212/g, "-");
  if (cleaned === "") throw new RangeError("Empty amount");
  const plain =
    format === "en-US" ? cleaned.replaceAll(",", "") : cleaned.replaceAll(".", "").replace(",", ".");
  return parseCents(plain);
}

export type Grain = "month" | "year";

/**
 * The last month of the period the Accounts page is showing. `offset` steps back one grain at a
 * time, so 0 is the period still running: the current month, or the current year to date.
 */
export function periodEnd(grain: Grain, offset: number, todayOn: CivilDate): MonthKey {
  const thisMonth = monthKey(todayOn);
  if (offset <= 0) return thisMonth;
  if (grain === "month") return addMonths(thisMonth, -offset);
  return `${Number(thisMonth.slice(0, 4)) - offset}-12-01`;
}
