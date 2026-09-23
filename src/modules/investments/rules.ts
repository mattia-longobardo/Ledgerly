import { z } from "zod";
import { type CivilDate, isCivilDate, lastDayOfMonth, type MonthKey } from "@/platform/dates";
import type { Cents } from "@/platform/money";

export const MOVEMENT_KINDS = ["deposit", "withdrawal"] as const;
export type MovementKind = (typeof MOVEMENT_KINDS)[number];

/**
 * A movement between the person and a trading platform. The amount is always positive: the kind
 * says which way the money went. It is a record of the platform, not of an account — linking it to
 * a bank movement documents where the money came from and changes no balance anywhere.
 */
export interface MovementLike {
  platformId: string;
  kind: MovementKind;
  amountCents: Cents;
  on: CivilDate;
}

/** What a platform was worth at the end of a day, as the person read it on the platform. */
export interface ValuationLike {
  platformId: string;
  on: CivilDate;
  valueCents: Cents;
}

// ——— Input ————————————————————————————————————————————————————————————————————————————————

const civilDate = z.string().refine(isCivilDate, "Not a civil date");

/** Only a web address: a `javascript:` or `data:` link is not a trading platform. */
const webUrl = z
  .string()
  .trim()
  .max(500)
  .transform((value) => (value === "" || /^[a-z][a-z0-9+.-]*:/i.test(value) ? value : `https://${value}`))
  .refine((value) => {
    if (value === "") return true;
    try {
      const url = new URL(value);
      return (url.protocol === "https:" || url.protocol === "http:") && url.hostname.includes(".");
    } catch {
      return false;
    }
  }, "Not a web address")
  .transform((value) => (value === "" ? null : value));

export const platformInputSchema = z.object({
  name: z.string().trim().min(1).max(60),
  url: z.union([webUrl, z.null()]).default(null),
});
export type PlatformInput = z.input<typeof platformInputSchema>;

const note = z
  .string()
  .trim()
  .max(200)
  .transform((value) => (value === "" ? null : value))
  .nullable()
  .default(null);

export const movementInputSchema = z.object({
  platformId: z.uuid(),
  kind: z.enum(MOVEMENT_KINDS),
  amountCents: z.bigint().positive(),
  on: civilDate,
  transactionId: z.uuid().nullable().default(null),
  note,
});
export type MovementInput = z.input<typeof movementInputSchema>;

export const valuationInputSchema = z.object({
  valueCents: z.bigint().nonnegative(),
  on: civilDate,
});

// ——— Statistics ————————————————————————————————————————————————————————————————————————————

export interface PlatformStats {
  depositedCents: Cents;
  withdrawnCents: Cents;
  /** What is still in: deposited − withdrawn. Negative once more came out than went in. */
  netCents: Cents;
  /**
   * What the platform is worth today: the latest valuation, plus what went in and minus what came
   * out after it (never below zero). `null` — unknown, never zero — when nobody has valued it yet.
   */
  valueCents: Cents | null;
  valuedOn: CivilDate | null;
  /** `true` when movements came after the latest valuation, so `valueCents` is an estimate. */
  estimated: boolean;
  /** value + withdrawn − deposited: what the platform gave back beyond what was put in. */
  gainCents: Cents | null;
  /** gain ÷ deposited; `null` without a value or without a deposit. */
  returnRate: number | null;
}

function sum(movements: readonly MovementLike[], kind: MovementKind): Cents {
  return movements.reduce<Cents>(
    (total, movement) => (movement.kind === kind ? total + movement.amountCents : total),
    0n,
  );
}

function signed(movement: MovementLike): Cents {
  return movement.kind === "deposit" ? movement.amountCents : -movement.amountCents;
}

/**
 * A platform's value at the end of `on`: the last valuation on or before it, moved by the flows
 * after it up to `on`. A valuation dated the same day as a movement is the value at the end of that
 * day, so that day's movements are already in it. `null` when there is no valuation yet and money
 * has already gone in; zero when nothing has happened at all.
 */
export function valueOn(
  movements: readonly MovementLike[],
  valuations: readonly ValuationLike[],
  on: CivilDate,
): { valueCents: Cents | null; valuedOn: CivilDate | null; estimated: boolean } {
  const latest = valuations
    .filter((valuation) => valuation.on <= on)
    .reduce<ValuationLike | null>(
      (last, valuation) => (last === null || valuation.on > last.on ? valuation : last),
      null,
    );
  const upTo = movements.filter((movement) => movement.on <= on);
  if (latest === null) {
    return { valueCents: upTo.length === 0 ? 0n : null, valuedOn: null, estimated: false };
  }
  const after = upTo.filter((movement) => movement.on > latest.on);
  const moved = after.reduce<Cents>((total, movement) => total + signed(movement), 0n);
  const value = latest.valueCents + moved;
  return { valueCents: value < 0n ? 0n : value, valuedOn: latest.on, estimated: after.length > 0 };
}

/** One platform's (or several platforms') figures on `on`, from its movements and valuations. */
export function platformStats(
  movements: readonly MovementLike[],
  valuations: readonly ValuationLike[],
  on: CivilDate,
): PlatformStats {
  const upTo = movements.filter((movement) => movement.on <= on);
  const depositedCents = sum(upTo, "deposit");
  const withdrawnCents = sum(upTo, "withdrawal");
  const { valueCents, valuedOn, estimated } = valueOn(movements, valuations, on);
  const gainCents = valueCents === null ? null : valueCents + withdrawnCents - depositedCents;
  return {
    depositedCents,
    withdrawnCents,
    netCents: depositedCents - withdrawnCents,
    valueCents,
    valuedOn,
    estimated,
    gainCents,
    returnRate:
      gainCents === null || depositedCents === 0n ? null : Number(gainCents) / Number(depositedCents),
  };
}

/**
 * The whole portfolio: the sums of the platforms' figures. The value is `null` as soon as one
 * platform with money in it has none — a total missing a term would be a wrong number in the shape
 * of a right one — and `partial` says so, so the page can name what is missing.
 */
export function portfolioStats(perPlatform: readonly PlatformStats[]): PlatformStats & { partial: boolean } {
  const depositedCents = perPlatform.reduce<Cents>((total, one) => total + one.depositedCents, 0n);
  const withdrawnCents = perPlatform.reduce<Cents>((total, one) => total + one.withdrawnCents, 0n);
  const partial = perPlatform.some((one) => one.valueCents === null);
  const valueCents = partial
    ? null
    : perPlatform.reduce<Cents>((total, one) => total + (one.valueCents as Cents), 0n);
  const gainCents = valueCents === null ? null : valueCents + withdrawnCents - depositedCents;
  // The total is as old as its oldest term — but a closed platform (worth zero) holds nothing
  // that could have moved since, so it does not age the total.
  const holding = perPlatform.filter((one) => one.valueCents !== null && one.valueCents > 0n);
  const dates = (holding.length > 0 ? holding : perPlatform).flatMap((one) =>
    one.valuedOn === null ? [] : [one.valuedOn],
  );
  return {
    depositedCents,
    withdrawnCents,
    netCents: depositedCents - withdrawnCents,
    valueCents,
    valuedOn: dates.length === 0 ? null : dates.reduce((a, b) => (a < b ? a : b)),
    estimated: perPlatform.some((one) => one.estimated),
    gainCents,
    returnRate:
      gainCents === null || depositedCents === 0n ? null : Number(gainCents) / Number(depositedCents),
    partial,
  };
}

/**
 * The history the chart draws: at the end of each month, what was still invested (deposited −
 * withdrawn so far) and what the platforms were worth, summed over `platformIds`. A month where one
 * platform with money in it had no valuation yet has no value (`null`), not a smaller one.
 */
export function monthlyHistory(
  platformIds: readonly string[],
  movements: readonly MovementLike[],
  valuations: readonly ValuationLike[],
  months: readonly MonthKey[],
): { invested: (Cents | null)[]; value: (Cents | null)[] } {
  const first = movements.reduce<CivilDate | null>(
    (min, movement) => (min === null || movement.on < min ? movement.on : min),
    null,
  );
  const invested: (Cents | null)[] = [];
  const value: (Cents | null)[] = [];
  for (const month of months) {
    const end = lastDayOfMonth(month);
    if (first === null || end < first) {
      invested.push(null);
      value.push(null);
      continue;
    }
    invested.push(
      movements
        .filter((movement) => movement.on <= end)
        .reduce<Cents>((total, movement) => total + signed(movement), 0n),
    );
    let total: Cents | null = 0n;
    for (const id of platformIds) {
      const one = valueOn(
        movements.filter((movement) => movement.platformId === id),
        valuations.filter((valuation) => valuation.platformId === id),
        end,
      ).valueCents;
      total = one === null || total === null ? null : total + one;
    }
    value.push(total);
  }
  return { invested, value };
}
