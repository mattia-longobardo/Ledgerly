import { z } from "zod";
import { addDays, type CivilDate, lastDayOfMonth, type MonthKey } from "../../shared/dates";
import { type Cents, wholePercent } from "../../shared/money";
import { civilDate } from "../../shared/inputs";

export const POCKET_STATES = ["active", "paused", "archived"] as const;
export const MOVEMENT_KINDS = ["accrual", "deposit", "withdrawal", "adjustment"] as const;
/** The kinds a row of `pocket_movements` holds: a spend is worked out, never stored (R5f, POC-4). */
export const STORED_MOVEMENT_KINDS = ["accrual", "deposit"] as const;
type MovementKind = (typeof MOVEMENT_KINDS)[number];
/**
 * Why a pocket's share of the backing account's interest is what it is (spec §7.4): an estimate
 * from the account's accruals (F4), none because the account has no interest rule or no positive
 * balance, or none because a standalone pocket rests on no account at all.
 */
export const INTEREST_REASONS = ["estimate", "no_interest_data", "standalone"] as const;
export type InterestReason = (typeof INTEREST_REASONS)[number];

interface MovementLike {
  kind: MovementKind;
  amountCents: Cents;
  on: CivilDate;
}

/**
 * An expense counted against a pocket: every `expense` of its backing account since the start
 * month, or the expenses linked to a standalone one by hand. The amount is positive.
 */
interface PocketSpend {
  on: CivilDate;
  cents: Cents;
}

/**
 * A pocket's ledger: its own movements and its expenses, the expenses as the negative movements
 * they are. The monthly accrual raises a budget, it is not money put aside — so what is left is the
 * budget accrued (plus anything added by hand) minus what was spent, and it carries over from one
 * month to the next.
 */
export function pocketLedger(
  movements: readonly MovementLike[],
  spends: readonly PocketSpend[],
): MovementLike[] {
  return [
    ...movements,
    ...spends.map((spend) => ({ kind: "withdrawal" as const, amountCents: -spend.cents, on: spend.on })),
  ];
}

/** The budget a pocket has been given: its accruals, deposits and adjustments, nothing spent. */
export function pocketBudget(movements: readonly MovementLike[]): Cents {
  return pocketBalance(movements.filter((movement) => movement.kind !== "withdrawal"));
}

/** How long a planned expense stays on the page after its day, unless removed sooner. */
export const PLANNED_GRACE_DAYS = 7;

/** Whether a planned expense is still shown and counted: up to a week past its day. */
export function plannedVisible(dueOn: CivilDate, todayOn: CivilDate): boolean {
  return addDays(dueOn, PLANNED_GRACE_DAYS) >= todayOn;
}

/** Spec §7.4: a pocket's balance is the sum of its movements. */
export function pocketBalance(movements: readonly Pick<MovementLike, "amountCents">[]): Cents {
  return movements.reduce<Cents>((sum, movement) => sum + movement.amountCents, 0n);
}

/**
 * Spec §7.4: months to the target, `ceil((target − balance) / monthly accrual)`. Zero once reached;
 * `null` without a target, or without an accrual while there is still a way to go.
 */
export function etaMonths(target: Cents | null, balance: Cents, monthly: Cents | null): number | null {
  if (target === null) return null;
  if (balance >= target) return 0;
  if (monthly === null || monthly <= 0n) return null;
  const missing = target - balance;
  return Number((missing + monthly - 1n) / monthly);
}

/** How far a pocket is to its target: a whole percent, rounded half up; `null` without a target. */
export function targetPercent(balance: Cents, target: Cents | null): number | null {
  return target === null ? null : wholePercent(balance, target);
}

/**
 * Spec §7.4 "stima" (audit POC-5): a pocket's share of what its backing account accrued in the last
 * twelve months, `accrued × pocket ÷ account`, rounded half up. `null` — unknown, never zero —
 * without an interest rule on the account, or without a positive balance on either side (plan F4
 * §3.4.10).
 */
export function splitInterest(
  accrued: Cents | null,
  accountBalance: Cents | null,
  pocketBalance: Cents,
): Cents | null {
  if (accrued === null || accountBalance === null || accountBalance <= 0n || pocketBalance <= 0n) return null;
  return (accrued * pocketBalance * 2n + accountBalance) / (accountBalance * 2n);
}

/**
 * Spec §7.4 "Free (not earmarked)": the latest balances of the distinct backing accounts minus the
 * balances of the pockets resting on them. `null` when one of those accounts has no balance — a
 * sum missing a term would be a wrong number in the shape of a right one (§4.3) — and when no
 * pocket rests on an account at all. Standalone pockets are in no account and in neither term.
 */
export function freeBalance(
  accountBalances: ReadonlyMap<string, Cents>,
  pockets: readonly { backingAccountId: string | null; balanceCents: Cents }[],
): { backingCents: Cents | null; earmarkedCents: Cents; freeCents: Cents | null } {
  const backed = pockets.filter((pocket) => pocket.backingAccountId !== null);
  const earmarkedCents = backed.reduce<Cents>((sum, pocket) => sum + pocket.balanceCents, 0n);
  const accounts = [...new Set(backed.map((pocket) => pocket.backingAccountId as string))];
  if (accounts.length === 0 || accounts.some((id) => !accountBalances.has(id))) {
    return { backingCents: null, earmarkedCents, freeCents: null };
  }
  const backingCents = accounts.reduce<Cents>((sum, id) => sum + (accountBalances.get(id) as Cents), 0n);
  return { backingCents, earmarkedCents, freeCents: backingCents - earmarkedCents };
}

/** The balance at the end of each month (the design's "Earmarked · 12 months"); `null` before any movement. */
export function monthEndBalances(
  movements: readonly MovementLike[],
  months: readonly MonthKey[],
): (Cents | null)[] {
  const sorted = [...movements].sort((a, b) => (a.on < b.on ? -1 : a.on > b.on ? 1 : 0));
  return months.map((month) => {
    const end = lastDayOfMonth(month);
    const upTo = sorted.filter((movement) => movement.on <= end);
    return upTo.length === 0 ? null : pocketBalance(upTo);
  });
}

const monthKey = civilDate().refine((value) => value.endsWith("-01"), "Not a month");
const positive = z.bigint().positive();

export const pocketInputSchema = z.object({
  name: z.string().trim().min(1).max(60),
  color: z
    .string()
    .regex(/^#[0-9a-f]{6}$/i)
    .nullable()
    .default(null),
  backingAccountId: z.uuid().nullable().default(null),
  targetCents: positive.nullable().default(null),
  monthlyCents: positive.nullable().default(null),
  startMonth: monthKey,
  /** The day of the month the accrual lands on (R5a, ST-15, D6): 1 to 31, the 1st as before. */
  // Left out: the 1st for a new pocket, the day it has for a change (the screens before R5a).
  accrualDay: z.number().int().min(1).max(31).optional(),
});

/**
 * The day a month's accrual lands on (D6): the chosen day, or the last day of a month that does not
 * have it (the 31st is the 28th in February and the 30th in April).
 */
export function accrualOn(month: CivilDate, day: number): CivilDate {
  const last = Number(lastDayOfMonth(month).slice(8));
  return `${month.slice(0, 8)}${String(Math.min(day, last)).padStart(2, "0")}`;
}

export type PocketInput = z.input<typeof pocketInputSchema>;

export const moveSchema = z.object({
  cents: positive,
  on: civilDate(),
  reason: z
    .string()
    .trim()
    .max(200)
    .transform((value) => (value === "" ? null : value))
    .nullable()
    .default(null),
});

export const plannedSchema = z.object({
  cents: positive,
  dueOn: civilDate(),
  description: z.string().trim().min(1).max(200),
});
