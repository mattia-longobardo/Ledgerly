// The balance after the movements a person writes by hand (12-account-modes.md §12.2). Part of
// `rules`; pure.
import type { CivilDate } from "../../../shared/dates";
import type { Cents } from "../../../shared/money";
import type { AccountMode } from "./provider";
import { type BalancePoint, byDay } from "./series";

/**
 * The modes a person may write a movement on by hand: every one. On a `two_way` account the
 * movement is sent to the source at the next update (N3.1, decision H36).
 */
export const MANUAL_MOVEMENT_MODES: readonly AccountMode[] = ["manual", "two_way", "read_only"];

/** A reading of an account's balance: one per day, with the moment it was taken. */
export interface BalanceReading {
  on: CivilDate;
  cents: Cents;
  capturedAt: Date;
}

/** A movement written by hand, as the balance rule sees it. */
export interface ManualMovement {
  on: CivilDate;
  cents: Cents;
  /** When the person wrote it: what tells it from a movement a same-day reading already holds. */
  writtenAt: Date;
}

/**
 * The reading a manual movement adds to (§12.2): the latest one taken before it. A reading of a
 * later day, or one of the same day taken after the movement was written, already holds it — a
 * balance counted on the 10th contains an expense of the 5th written on the 15th — and then the
 * movement changes nothing: `null`, as when the account has no reading yet.
 */
function readingBefore(sorted: readonly BalanceReading[], movement: ManualMovement): BalanceReading | null {
  let last: BalanceReading | null = null;
  for (const reading of sorted) {
    if (reading.on > movement.on) break;
    last = reading;
  }
  if (last === null) return null;
  if (last.on === movement.on && last.capturedAt >= movement.writtenAt) return null;
  return last;
}

/**
 * The balances a person's manual movements make (§12.2): balance = last known balance + the manual
 * movements after it. One point for each day a movement that no reading holds yet falls on, and
 * one for each day in `copies` after it — the days the app copied or rebuilt a balance on, which
 * would otherwise stand in front of the point with the older value. Each reading starts again: the
 * movements before it are in it.
 *
 * `readings` holds one reading per day at most. Rebuilt from scratch on every change, like
 * `deriveMonthEnds`.
 */
export function movementBalances(
  readings: readonly BalanceReading[],
  movements: readonly ManualMovement[],
  copies: readonly CivilDate[] = [],
): BalancePoint[] {
  if (readings.length === 0 || movements.length === 0) return [];
  const sorted = [...readings].sort(byDay);
  const byReading = new Map<CivilDate, ManualMovement[]>();
  for (const movement of movements) {
    const reading = readingBefore(sorted, movement);
    if (reading === null) continue;
    const list = byReading.get(reading.on) ?? [];
    list.push(movement);
    byReading.set(reading.on, list);
  }

  const points: BalancePoint[] = [];
  sorted.forEach((reading, index) => {
    const own = (byReading.get(reading.on) ?? []).sort(byDay);
    if (own.length === 0) return;
    const next = sorted[index + 1]?.on ?? null;
    const days = new Set(own.map((movement) => movement.on));
    for (const day of copies) {
      if (day > own[0].on && (next === null || day < next)) days.add(day);
    }
    for (const day of [...days].sort()) {
      const moved = own
        .filter((movement) => movement.on <= day)
        .reduce((sum, movement) => sum + movement.cents, 0n);
      points.push({ on: day, cents: reading.cents + moved });
    }
  });
  return points;
}

/** The manual movements dated before an account's first reading, its opening (PERS-678). */
export interface BeforeOpening {
  count: number;
  /** The day of the earliest of them. */
  first: CivilDate;
  /** The day of the first reading. */
  openingOn: CivilDate;
}

/**
 * The manual movements no reading comes before (PERS-678): `movementBalances` leaves them out, as
 * the opening holds them (decision 12) — those of an earlier day, and those of its own day written
 * before it was taken (PERS-725). Right for a balance a bank or a person counted on that day,
 * wrong when the opening means «the account starts here»: only the person can tell, so the app
 * says it and never moves the balance by itself. `null` with none, or with no reading at all.
 */
export function movementsBeforeOpening(
  readings: readonly Pick<BalanceReading, "on" | "capturedAt">[],
  movements: readonly Pick<ManualMovement, "on" | "writtenAt">[],
): BeforeOpening | null {
  const opening = readings.reduce<Pick<BalanceReading, "on" | "capturedAt"> | null>(
    (first, reading) => (first === null || reading.on < first.on ? reading : first),
    null,
  );
  if (opening === null) return null;
  const before = movements
    .filter(
      (movement) =>
        movement.on < opening.on || (movement.on === opening.on && opening.capturedAt >= movement.writtenAt),
    )
    .map((movement) => movement.on);
  if (before.length === 0) return null;
  return { count: before.length, first: before.sort()[0], openingOn: opening.on };
}

/** Several accounts' {@link BeforeOpening} as one answer of a write: the count and the earliest day. */
export function joinedBeforeOpening(
  each: Iterable<BeforeOpening>,
): Pick<BeforeOpening, "count" | "first"> | null {
  const all = [...each];
  if (all.length === 0) return null;
  return {
    count: all.reduce((sum, one) => sum + one.count, 0),
    first: all.map((one) => one.first).sort()[0],
  };
}

/** What one more manual movement does to today's balance, for the line under the dialog's account. */
export type MovementEffect =
  | { kind: "change"; before: Cents; after: Cents }
  /** A reading taken on `readingOn` already holds the movement's day. */
  | { kind: "unchanged"; readingOn: CivilDate }
  /** The account has no balance yet. */
  | { kind: "none" };

/** The balance on `day`: the latest of the readings and of the movement points, a point first. */
function balanceOn(
  readings: readonly BalanceReading[],
  points: readonly BalancePoint[],
  day: CivilDate,
): Cents | null {
  let best: { on: CivilDate; cents: Cents } | null = null;
  for (const reading of readings) {
    if (reading.on <= day && (best === null || reading.on > best.on)) best = reading;
  }
  for (const point of points) {
    if (point.on <= day && (best === null || point.on >= best.on)) best = point;
  }
  return best?.cents ?? null;
}

/**
 * Today's balance before and after `candidate`, by the same rule that writes the balance
 * (`movementBalances`): the dialog shows these numbers and never works them out itself.
 * `movements` are the manual movements the account has; `replaces` is the one of them the
 * candidate takes the place of, when a movement is being changed.
 */
export function movementEffect(
  readings: readonly BalanceReading[],
  movements: readonly ManualMovement[],
  candidate: ManualMovement,
  today: CivilDate,
  replaces?: ManualMovement,
): MovementEffect {
  const sorted = [...readings].sort(byDay);
  const before = balanceOn(sorted, movementBalances(sorted, movements), today);
  if (before === null) return { kind: "none" };
  const kept = movements.filter((movement) => movement !== replaces);
  const after = balanceOn(sorted, movementBalances(sorted, [...kept, candidate]), today);
  if (after !== null && after !== before) return { kind: "change", before, after };
  const held = sorted.find((reading) => reading.on >= candidate.on);
  return held ? { kind: "unchanged", readingOn: held.on } : { kind: "none" };
}

/**
 * A daily series (`dailySeries`) with the manual movements in it: from the day of a movement point
 * until the next reading, the day's value moves by what the point adds to the reading under it.
 */
export function withMovementPoints(
  values: readonly (Cents | null)[],
  days: readonly CivilDate[],
  readings: readonly { on: CivilDate; cents: Cents }[],
  points: readonly BalancePoint[],
): (Cents | null)[] {
  if (points.length === 0) return [...values];
  const sorted = [...readings].sort(byDay);
  const ordered = [...points].sort(byDay);
  return days.map((day, index) => {
    const value = values[index];
    if (value === null) return null;
    const point = ordered.filter((one) => one.on <= day).at(-1);
    if (!point) return value;
    const under = sorted.filter((reading) => reading.on <= point.on).at(-1);
    if (!under) return value;
    const covered = sorted.some((reading) => reading.on > point.on && reading.on <= day);
    return covered ? value : value + (point.cents - under.cents);
  });
}
