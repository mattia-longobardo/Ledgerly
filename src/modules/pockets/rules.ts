import { z } from "zod";
import { type CivilDate, isCivilDate, lastDayOfMonth, type MonthKey } from "@/platform/dates";
import type { Cents } from "@/platform/money";

export const POCKET_STATES = ["active", "paused", "archived"] as const;
export const MOVEMENT_KINDS = ["accrual", "deposit", "withdrawal", "adjustment"] as const;

export type PocketState = (typeof POCKET_STATES)[number];
export type MovementKind = (typeof MOVEMENT_KINDS)[number];

export interface MovementLike {
  kind: MovementKind;
  amountCents: Cents;
  on: CivilDate;
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

/** What was withdrawn on or after `from`, as the negative amount it is. */
export function withdrawnSince(movements: readonly MovementLike[], from: CivilDate): Cents {
  return pocketBalance(movements.filter((movement) => movement.kind === "withdrawal" && movement.on >= from));
}

const civilDate = z.string().refine(isCivilDate, "Not a civil date");
const monthKey = civilDate.refine((value) => value.endsWith("-01"), "Not a month");
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
});

export type PocketInput = z.input<typeof pocketInputSchema>;

export const moveSchema = z.object({
  cents: positive,
  on: civilDate,
  reason: z
    .string()
    .trim()
    .max(200)
    .transform((value) => (value === "" ? null : value))
    .nullable()
    .default(null),
});

export const withdrawalSchema = moveSchema.extend({ reason: z.string().trim().min(1).max(200) });
