/**
 * The pure rules of moving an account from one source to another (rewrite plan N4, 04-now.md §4.6
 * and §4.6.1): which movements of the two sources are the same, and which movements between the
 * account and the other accounts of the same bank are one transfer. No provider name, no database:
 * the services read the rows, these functions decide, and the services write.
 *
 * Both rules take no choice when the data do not allow one: with different counts in a group,
 * nothing is tied (criterion 2 of N4, decision H44; risk R-34).
 */
import { addDays, type CivilDate } from "@/platform/dates";
import type { Cents } from "@/platform/money";

/** The days the two sides of a movement may be apart: a bank books later than the source writes. */
export const SWITCH_MATCH_MAX_DAYS = 5;

/** One movement as the comparison reads it. */
export interface SwitchMovement {
  id: string;
  day: CivilDate;
  /** Signed: negative is money out. */
  amountCents: Cents;
  text: string;
}

/** A movement of the account and the bank's movement that is the same one. */
export interface SwitchMatch {
  localId: string;
  bankId: string;
}

/** One amount whose movements are in different numbers on the two sides: nothing of it is tied. */
export interface SwitchToCheck {
  amountCents: Cents;
  localIds: string[];
  bankIds: string[];
}

export interface SwitchComparison {
  matched: SwitchMatch[];
  toCheck: SwitchToCheck[];
  /** Movements of the source that the bank has not got in the period. */
  onlyLocal: string[];
  /** Movements of the bank, in the period, that the source has not got. */
  onlyBank: string[];
}

const DAY_MS = 86_400_000;

/** Whole days from one civil date to another. */
export function daysBetween(a: CivilDate, b: CivilDate): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS);
}

/** The words of a text, upper case, with no punctuation: what two sources both keep of it. */
function words(text: string): Set<string> {
  return new Set(
    text
      .toUpperCase()
      .replace(/[^A-Z0-9À-Ý]+/g, " ")
      .split(" ")
      .filter((word) => word.length >= 3),
  );
}

/** How much two texts share, from 0 to 1. */
export function textScore(a: string, b: string): number {
  const left = words(a);
  const right = words(b);
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  for (const word of left) if (right.has(word)) shared += 1;
  return shared / Math.min(left.size, right.size);
}

const byDayThenId = (a: SwitchMovement, b: SwitchMovement) =>
  a.day < b.day ? -1 : a.day > b.day ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

/**
 * Rule M1 as the spike corrected it (04-now.md §4.6): movements are grouped by amount, and the
 * counts of the two sides are compared first. Only a group with the same count on both sides is
 * tied, movement by movement: the best text first, then the nearest day, never more than
 * {@link SWITCH_MATCH_MAX_DAYS} apart. A group with a different count, or one that cannot be tied
 * whole inside the window, goes to "To check" and nothing of it is tied. A group on one side only
 * is "only on the source" or "only in the bank".
 */
export function compareSources(
  local: readonly SwitchMovement[],
  bank: readonly SwitchMovement[],
  maxDays = SWITCH_MATCH_MAX_DAYS,
): SwitchComparison {
  const groups = new Map<string, { local: SwitchMovement[]; bank: SwitchMovement[] }>();
  const groupOf = (amount: Cents) => {
    const key = amount.toString();
    let group = groups.get(key);
    if (!group) groups.set(key, (group = { local: [], bank: [] }));
    return group;
  };
  for (const one of local) groupOf(one.amountCents).local.push(one);
  for (const one of bank) groupOf(one.amountCents).bank.push(one);

  const outcome: SwitchComparison = { matched: [], toCheck: [], onlyLocal: [], onlyBank: [] };
  const keys = [...groups.keys()].sort((a, b) => {
    const x = BigInt(a);
    const y = BigInt(b);
    return x < y ? -1 : x > y ? 1 : 0;
  });
  for (const key of keys) {
    const group = groups.get(key)!;
    group.local.sort(byDayThenId);
    group.bank.sort(byDayThenId);
    if (group.bank.length === 0) {
      outcome.onlyLocal.push(...group.local.map((one) => one.id));
      continue;
    }
    if (group.local.length === 0) {
      outcome.onlyBank.push(...group.bank.map((one) => one.id));
      continue;
    }
    const pairs =
      group.local.length === group.bank.length ? tieGroup(group.local, group.bank, maxDays) : null;
    if (pairs === null) {
      outcome.toCheck.push({
        amountCents: BigInt(key),
        localIds: group.local.map((one) => one.id),
        bankIds: group.bank.map((one) => one.id),
      });
      continue;
    }
    outcome.matched.push(...pairs);
  }
  outcome.matched.sort((a, b) => (a.localId < b.localId ? -1 : a.localId > b.localId ? 1 : 0));
  return outcome;
}

/**
 * Ties a group whose two sides have the same count: each movement of the source, by day, takes the
 * free movement of the bank inside the window with the best text, then the nearest day, then the
 * earliest. `null` when one movement finds none: the whole group is then "To check".
 */
function tieGroup(
  local: readonly SwitchMovement[],
  bank: readonly SwitchMovement[],
  maxDays: number,
): SwitchMatch[] | null {
  const free = new Set(bank.map((one) => one.id));
  const pairs: SwitchMatch[] = [];
  for (const mine of local) {
    let best: { one: SwitchMovement; score: number; distance: number } | null = null;
    for (const theirs of bank) {
      if (!free.has(theirs.id)) continue;
      const distance = Math.abs(daysBetween(mine.day, theirs.day));
      if (distance > maxDays) continue;
      const score = textScore(mine.text, theirs.text);
      if (
        best === null ||
        score > best.score ||
        (score === best.score && distance < best.distance) ||
        (score === best.score && distance === best.distance && byDayThenId(theirs, best.one) < 0)
      ) {
        best = { one: theirs, score, distance };
      }
    }
    if (best === null) return null;
    free.delete(best.one.id);
    pairs.push({ localId: mine.id, bankId: best.one.id });
  }
  return pairs;
}

/** The first day the comparison reads: ten days before the last day the source read (04-now.md §4.6). */
export const SWITCH_OVERLAP_DAYS = 10;

export function comparisonFrom(cutDate: CivilDate): CivilDate {
  return addDays(cutDate, -SWITCH_OVERLAP_DAYS);
}

/** A movement of the account of the bank already here, and the movement of the switched account it doubles. */
export interface DoubleMatch {
  doubleId: string;
  keptId: string;
}

export interface DoubleComparison {
  matched: DoubleMatch[];
  /** Movements of the account already here that the switched account has not got: no "Apply". */
  unmatched: string[];
}

/**
 * Ties every movement of the bank's account already here (`doubles`) to the movement of the switched
 * account that it repeats (`kept`), for a switch that joins the two accounts (H39 for already imported
 * accounts). The switched account has a longer history, so it may have more movements of an amount:
 * a group is tied when it has at least as many movements kept as doubles, each double taking the free
 * movement kept in the window with the best text, then the nearest day. A group with more doubles, or
 * with a double that finds none, is not tied at all: its doubles are `unmatched`.
 */
export function matchDoubles(
  doubles: readonly SwitchMovement[],
  kept: readonly SwitchMovement[],
  maxDays = SWITCH_MATCH_MAX_DAYS,
): DoubleComparison {
  const groups = new Map<string, { doubles: SwitchMovement[]; kept: SwitchMovement[] }>();
  const groupOf = (amount: Cents) => {
    const key = amount.toString();
    let group = groups.get(key);
    if (!group) groups.set(key, (group = { doubles: [], kept: [] }));
    return group;
  };
  for (const one of doubles) groupOf(one.amountCents).doubles.push(one);
  for (const one of kept) groupOf(one.amountCents).kept.push(one);

  const outcome: DoubleComparison = { matched: [], unmatched: [] };
  for (const group of groups.values()) {
    if (group.doubles.length === 0) continue;
    group.doubles.sort(byDayThenId);
    group.kept.sort(byDayThenId);
    const pairs =
      group.doubles.length <= group.kept.length ? tieGroup(group.doubles, group.kept, maxDays) : null;
    if (pairs === null) {
      outcome.unmatched.push(...group.doubles.map((one) => one.id));
      continue;
    }
    outcome.matched.push(...pairs.map((pair) => ({ doubleId: pair.localId, keptId: pair.bankId })));
  }
  outcome.matched.sort((a, b) => (a.doubleId < b.doubleId ? -1 : a.doubleId > b.doubleId ? 1 : 0));
  outcome.unmatched.sort();
  return outcome;
}

/* Transfers between the accounts of one bank, on the whole history (decision H40) */

/** A movement as the transfer rule reads it. */
export interface TransferCandidate {
  id: string;
  accountId: string;
  day: CivilDate;
  /** Signed: negative is money out. */
  amountCents: Cents;
  currency: string;
}

/** One transfer the rule found: the money left `fromAccountId` and reached `toAccountId`. */
export interface TransferPair {
  outId: string;
  inId: string;
  fromAccountId: string;
  toAccountId: string;
  outDay: CivilDate;
  inDay: CivilDate;
  /** Never negative. */
  amountCents: Cents;
  currency: string;
}

export interface TransferPlan {
  pairs: TransferPair[];
  /** Groups left alone because their two sides have different counts or are too far apart. */
  ambiguous: number;
  /** What leaves the income and the spending, by year of the money out. */
  byYear: { year: number; count: number; amountCents: Cents }[];
}

/**
 * The transfers between one account and the other accounts of the same bank (H40, 04-now.md §4.6.1
 * point 9), by amount and day. A money out on one account and a money in on the other, same amount
 * and currency, at most `maxDays` apart, are joined; the joined movements form a group (a component
 * of the graph). A group with the same count of money out and money in is paired by day, and only
 * when every pair is inside the window; any other group is left alone and counted as ambiguous.
 *
 * The caller gives only movements that may become a transfer: money in or out, not already one,
 * not hidden, not gone from their source.
 */
export function planTransfers(
  accountId: string,
  otherAccountIds: readonly string[],
  candidates: readonly TransferCandidate[],
  maxDays = SWITCH_MATCH_MAX_DAYS,
): TransferPlan {
  const others = new Set(otherAccountIds);
  const ours = candidates.filter(
    (one) => one.amountCents !== 0n && (one.accountId === accountId || others.has(one.accountId)),
  );
  const outs = ours.filter((one) => one.amountCents < 0n);
  const ins = ours.filter((one) => one.amountCents > 0n);
  // A money out and a money in are joined when exactly one of them is on the account.
  const joins = (out: TransferCandidate, into: TransferCandidate) =>
    out.accountId !== into.accountId &&
    (out.accountId === accountId) !== (into.accountId === accountId) &&
    out.currency === into.currency &&
    -out.amountCents === into.amountCents &&
    Math.abs(daysBetween(out.day, into.day)) <= maxDays;

  // The components of the graph, found by walking from each money out.
  const seen = new Set<string>();
  const byId = new Map(ours.map((one) => [one.id, one]));
  const neighbours = new Map<string, string[]>();
  for (const out of outs) {
    for (const into of ins) {
      if (!joins(out, into)) continue;
      neighbours.set(out.id, [...(neighbours.get(out.id) ?? []), into.id]);
      neighbours.set(into.id, [...(neighbours.get(into.id) ?? []), out.id]);
    }
  }
  const pairs: TransferPair[] = [];
  let ambiguous = 0;
  const starts = [...outs].sort(byDayThenIdOf);
  for (const start of starts) {
    if (seen.has(start.id) || !neighbours.has(start.id)) continue;
    const members: TransferCandidate[] = [];
    const queue = [start.id];
    seen.add(start.id);
    while (queue.length > 0) {
      const id = queue.shift()!;
      members.push(byId.get(id)!);
      for (const next of neighbours.get(id) ?? []) {
        if (seen.has(next)) continue;
        seen.add(next);
        queue.push(next);
      }
    }
    const groupOuts = members.filter((one) => one.amountCents < 0n).sort(byDayThenIdOf);
    const groupIns = members.filter((one) => one.amountCents > 0n).sort(byDayThenIdOf);
    const tied =
      groupOuts.length === groupIns.length ? groupOuts.map((out, at) => [out, groupIns[at]] as const) : null;
    if (tied === null || tied.some(([out, into]) => !joins(out, into))) {
      ambiguous += 1;
      continue;
    }
    for (const [out, into] of tied) {
      pairs.push({
        outId: out.id,
        inId: into.id,
        fromAccountId: out.accountId,
        toAccountId: into.accountId,
        outDay: out.day,
        inDay: into.day,
        amountCents: into.amountCents,
        currency: into.currency,
      });
    }
  }
  pairs.sort((a, b) => (a.outDay > b.outDay ? -1 : a.outDay < b.outDay ? 1 : a.outId < b.outId ? -1 : 1));

  const years = new Map<number, { count: number; amountCents: Cents }>();
  for (const pair of pairs) {
    const year = Number(pair.outDay.slice(0, 4));
    const total = years.get(year) ?? { count: 0, amountCents: 0n };
    years.set(year, { count: total.count + 1, amountCents: total.amountCents + pair.amountCents });
  }
  const byYear = [...years].map(([year, total]) => ({ year, ...total })).sort((a, b) => b.year - a.year);
  return { pairs, ambiguous, byYear };
}

function byDayThenIdOf(a: TransferCandidate, b: TransferCandidate): number {
  return a.day < b.day ? -1 : a.day > b.day ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** What a movement holds of the person's choices, as a join reads it. */
export interface MovementChoices {
  categoryId: string | null;
  categoryOrigin: string | null;
  note: string | null;
  locallyEdited: readonly string[];
}

/**
 * What a double gives the movement it repeats when a switch joins the two accounts: the category the
 * person chose on it, when the movement kept has none chosen by the person; the note the person wrote
 * on it, when the movement kept has no note. A category of the source or of the automatic cascade is
 * not the person's choice, so the person's choice on the double wins over it.
 */
export function takesFromDouble(
  double: MovementChoices,
  kept: MovementChoices,
): { category: boolean; note: boolean } {
  const category =
    double.categoryOrigin === "user" &&
    double.categoryId !== null &&
    kept.categoryOrigin !== "user" &&
    kept.categoryId !== double.categoryId;
  const note =
    double.locallyEdited.includes("note") &&
    (double.note ?? "").trim() !== "" &&
    (kept.note ?? "").trim() === "";
  return { category, note };
}
