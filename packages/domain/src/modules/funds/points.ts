// The documented values of a fund in time, as the engine and the home both walk them (audit FND-6).
import type { CivilDate } from "../../shared/dates";

/** A dated amount: a documented value of a fund. */
interface Dated {
  on: CivilDate;
}

/** Oldest first. */
export const sortedPoints = <T extends Dated>(points: readonly T[]): T[] =>
  [...points].sort((a, b) => (a.on < b.on ? -1 : a.on > b.on ? 1 : 0));

/** The newest point on or before a day; `null` when there is none. */
export const lastUpTo = <T extends Dated>(points: readonly T[], on: CivilDate): T | null => {
  let found: T | null = null;
  for (const point of points) if (point.on <= on && (found === null || point.on > found.on)) found = point;
  return found;
};
