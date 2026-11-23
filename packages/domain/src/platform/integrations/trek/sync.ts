/**
 * One pass of the leave sync with the external calendar (spec §9.2, plan F7 §3.4.7), through the
 * plugin `trek` (rewrite plan R5c): **write, then re-read, then reconcile**, one year at a time,
 * then the calendar's own figures once — reading them persists carry-over upstream. The plugin
 * speaks to the calendar; everything decided here — the desired days, what settles, what is
 * adopted, what is a conflict, the runs and the lock — is the core's.
 *
 * A pass whose read worked but whose send did not is recorded `failed` and sends no mail: at an
 * hourly cadence that would be noise, and the staleness badge is the right signal (§3.4.11). A
 * calendar that takes no writes (decision D5) is read and never written: what Ledgerly wrote stays
 * pending ("Da inviare"), and the run says `read_only` so the connection shows it. A user with no
 * Trek connection writes no `sync_runs` row at all.
 */
import type { LeaveDay, LeaveFigures, LeaveOutcome } from "@ledgerly/plugin-contract";
import { asTrekKind, TREK_KINDS } from "../../../modules/timeoff/rules";
import {
  datesHeld,
  markRefused,
  markSynced,
  recordFromTrek,
  trekDaysOf,
  yearsWithPending,
  yearWindow,
  type Observed,
  type TrekDay,
} from "../../../modules/timeoff/service";
import type { Ctx } from "../../context";
import type { CivilDate } from "../../../shared/dates";
import { today } from "../../../shared/dates";
import { withJobLock } from "../../jobs/lock";
import { TREK_PROVIDER } from "../rules";
import {
  finishRun,
  listConnections,
  markConnection,
  readSyncJob,
  recordRun,
  saveSyncJob,
  skipRun,
  type Connection,
} from "../service";
import { type CalendarCalls, isClientRefused, trekCalls } from "./calls";

const SYNC_LOCK_PREFIX = "trek-sync:";
const REVOKED_REASON = "the Trek token has been rejected; reconnect Trek in Settings › Integrations";
/** The code of a pass whose days could not be sent because the calendar takes no writes. */
const READ_ONLY = "read_only";

/**
 * A pass that did not happen because one was already running for this user. Not a failure and not
 * a `sync_runs` row: nothing was attempted, so nothing is logged.
 */
class TrekBusyError extends Error {
  readonly code = "busy";

  constructor(message = "a Trek pass is already running for this user") {
    super(message);
    this.name = "TrekBusyError";
  }
}

export function isTrekBusy(error: unknown): boolean {
  // The `name` arm holds where `instanceof` cannot: Next can load this module twice (a Server
  // Action bundle and a job bundle), and the same class is then two classes.
  return error instanceof TrekBusyError || (error instanceof Error && error.name === "TrekBusyError");
}

interface TrekSyncResult {
  /** The years the pass covered. */
  years: number[];
  counts: Record<string, number>;
  /** The calendar's own figures for the last year covered, as a cross-check; never our numbers. */
  figures: LeaveFigures | null;
  /** `"revoked"` when nothing was attempted because the token is already refused. */
  refused: "revoked" | null;
  /** Dates the calendar holds a day on that we keep under a kind which never goes there (§3.6.3). */
  conflicts: CivilDate[];
}

interface TrekSyncOptions {
  now?: Date;
  /** Injected in tests, so a pass can run against a plugin of the test. */
  calls?: CalendarCalls;
  /** Override the years covered; by default this year plus any year with something pending. */
  years?: readonly number[];
}

/* One year: which days the calendar should hold, one exchange, and what is true afterwards */

type Fraction = 0.5 | 1;
type CalendarKind = (typeof TREK_KINDS)[number];

interface DesiredDay {
  date: CivilDate;
  fraction: Fraction;
  kind: CalendarKind;
}

/** What one year's exchange produced. */
interface YearOutcome {
  /** What became of each day the write named; empty when nothing was written. */
  outcomes: LeaveOutcome[];
  /** The days asked to go: an `unchanged` among them was already absent. */
  removals: CivilDate[];
  adopted: number;
  settled: number;
  /**
   * Days where our state and the calendar's still do not agree once the pass is over. A day we had
   * settled and the calendar has since lost counts here too: the next pass has work to do on it.
   */
  unsettled: number;
  conflicts: CivilDate[];
}

/** What one row is worth: half a day or a whole one, the only two a day off comes in (N0). */
function dayShare(day: TrekDay): Fraction {
  return day.fraction === 0.5 ? 0.5 : 1;
}

/**
 * The desired state of one year, and what must be taken back.
 *
 * The calendar keeps one row per **date**; we keep one per date *and kind*. The two are reconciled
 * by **adding up**: half a day of ferie and half a day of ROL is one whole day away from the
 * office. The sum is capped at a whole day because that is the most a calendar row can hold.
 *
 * A date is a `removal` only once **nothing** of ours is left on it: while one half is still
 * wanted, the calendar keeps its row and the desired day simply shrinks it. The list stays explicit
 * and is never "whatever is missing from `desired`" (plan F7 §3.6.8).
 */
export function splitForTrek(days: readonly TrekDay[]): { desired: DesiredDay[]; removals: CivilDate[] } {
  const perDate = new Map<CivilDate, TrekDay[]>();
  for (const day of days) {
    if (day.pending === "delete") continue;
    perDate.set(day.on, [...(perDate.get(day.on) ?? []), day]);
  }
  const desired: DesiredDay[] = [];
  for (const [date, group] of perDate) {
    const share = group.reduce((sum, day) => sum + dayShare(day), 0);
    // Every kind that reaches the calendar lands on the same one (N4): the first row answers.
    desired.push({ date, fraction: share > 0.5 ? 1 : 0.5, kind: asTrekKind(group[0].kind) });
  }
  const removals = days
    .filter((day) => day.pending === "delete" && !perDate.has(day.on))
    .map((day) => day.on);
  return {
    desired: desired.sort((left, right) => (left.date < right.date ? -1 : 1)),
    removals: [...new Set(removals)].sort(),
  };
}

function isCalendarKind(kind: string | null): kind is CalendarKind {
  return TREK_KINDS.some((one) => one === kind);
}

/**
 * Which rows the calendar now holds as we meant them, and which still differ. Everything is decided
 * from the year read after the writes: a write that said "done" and one whose answer was lost are
 * treated the same way, by looking.
 */
function settle(
  days: readonly TrekDay[],
  wanted: ReadonlyMap<CivilDate, DesiredDay>,
  after: readonly LeaveDay[],
) {
  const upstream = new Map(after.map((entry) => [entry.day, entry]));
  const observed: Observed[] = [];
  let unsettled = 0;
  for (const day of days) {
    const entry = upstream.get(day.on);
    const want = wanted.get(day.on);
    // Compared against the **desired** day and not the row's own kind and fraction: a date
    // carrying two halves of ours is one row of 1.0 upstream, and that sighting settles both.
    const agreed = want !== undefined && entry?.kind === want.kind && entry.fraction === want.fraction;
    if (day.pending === "delete") {
      // The row may go once the calendar stopped counting it: the date is gone upstream, or what is
      // left of it is exactly the rest of the day, which this row is no longer part of.
      if (want === undefined ? entry === undefined : agreed)
        observed.push({ id: day.id, fraction: null, kind: null });
      else unsettled += 1;
    } else if (agreed) {
      observed.push({ id: day.id, fraction: want.fraction, kind: want.kind });
    } else {
      unsettled += 1;
    }
  }
  return { observed, unsettled };
}

interface AdoptInput {
  after: readonly LeaveDay[];
  wanted: ReadonlyMap<CivilDate, DesiredDay>;
  removals: readonly CivilDate[];
  now: Date;
}

/**
 * What the calendar holds and we do not becomes a row of ours. A date we already hold under another
 * kind is **not** adopted: our classification wins, and the date is reported (plan F7 §3.6.3).
 */
async function adopt(ctx: Pick<Ctx, "userId">, year: number, input: AdoptInput) {
  const held = await datesHeld(ctx, yearWindow(year));
  const asked = new Set(input.removals);
  const conflicts = new Set<CivilDate>();
  let adopted = 0;
  for (const entry of input.after) {
    // A day we asked to drop and that is still there is a removal that did not land, already
    // counted as unsettled: adopting it would undo the person's own deletion at the next pass.
    if (input.wanted.has(entry.day) || asked.has(entry.day)) continue;
    if (held.has(entry.day)) conflicts.add(entry.day);
    // A kind this app cannot hold a day under is left upstream rather than guessed.
    else if (isCalendarKind(entry.kind)) {
      await recordFromTrek(ctx, { on: entry.day, kind: entry.kind, fraction: entry.fraction }, input.now);
      adopted += 1;
    }
  }
  return { adopted, conflicts: [...conflicts].sort() };
}

/** One exchange: a write when there is something to say and the calendar takes writes, a read otherwise. */
async function exchange(
  calls: CalendarCalls,
  year: number,
  split: ReturnType<typeof splitForTrek>,
  readOnly: boolean,
) {
  if (readOnly || (split.desired.length === 0 && split.removals.length === 0)) {
    return { outcomes: [], days: await calls.read(year) };
  }
  const desired = split.desired.map((one) => ({ day: one.date, fraction: one.fraction, kind: one.kind }));
  return calls.write({ year, desired, remove: split.removals });
}

/** One year: the desired days, one exchange, and what is now true written down. */
async function passYear(
  ctx: Pick<Ctx, "userId">,
  calls: CalendarCalls,
  year: number,
  options: { now: Date; readOnly: boolean },
): Promise<YearOutcome> {
  const days = await trekDaysOf(ctx, yearWindow(year));
  const split = splitForTrek(days);
  const wanted = new Map(split.desired.map((one) => [one.date, one]));
  const { outcomes, days: after } = await exchange(calls, year, split, options.readOnly);

  const { observed, unsettled } = settle(days, wanted, after);
  await markSynced(ctx, observed, options.now);
  // A day the calendar does not take (a weekend) stays owed, and says it was refused.
  const notBookable = new Set(outcomes.filter((one) => one.reason === "not_bookable").map((one) => one.day));
  await markRefused(
    ctx,
    days.filter((day) => notBookable.has(day.on)).map((day) => day.id),
  );
  const { adopted, conflicts } = await adopt(ctx, year, {
    after,
    wanted,
    removals: split.removals,
    now: options.now,
  });
  return { outcomes, removals: split.removals, adopted, settled: observed.length, unsettled, conflicts };
}

/** What a pass last heard the calendar say about a year, or `null` if it has never been told. */
export async function trekStatsOf(ctx: Pick<Ctx, "userId">, year: number): Promise<LeaveFigures | null> {
  const connection = await trekConnection(ctx);
  if (connection === null) return null;
  const cursor = (await readSyncJob(ctx, connection.id, "leave"))?.cursor ?? null;
  if (cursor === null || cursor.year !== String(year)) return null;
  const numbers = {
    used: Number(cursor.used),
    remaining: Number(cursor.remaining),
    totalAvailable: Number(cursor.totalAvailable),
  };
  return Object.values(numbers).every((value) => Number.isFinite(value)) ? numbers : null;
}

export async function trekConnection(ctx: Pick<Ctx, "userId">): Promise<Connection | null> {
  return (await listConnections(ctx)).find((one) => one.provider === TREK_PROVIDER) ?? null;
}

/** Which years a pass covers: the one we are in, plus any year with something still pending. */
async function yearsToCover(ctx: Pick<Ctx, "userId" | "timeZone">, now: Date): Promise<number[]> {
  const current = Number(today(ctx.timeZone, now).slice(0, 4));
  const pending = await yearsWithPending(ctx);
  return [...new Set([current, ...pending])].sort((left, right) => left - right);
}

/** The counts of a pass, added up over its years. */
function countsOf(outcomes: readonly YearOutcome[], readOnly: boolean): Record<string, number> {
  const sum = (pick: (one: YearOutcome) => number) => outcomes.reduce((total, one) => total + pick(one), 0);
  const days = outcomes.flatMap((one) =>
    one.outcomes.map((outcome) => ({ outcome, removals: one.removals })),
  );
  const count = (test: (one: (typeof days)[number]) => boolean) => days.filter(test).length;
  const unsettled = sum((one) => one.unsettled);
  return {
    applied: count(({ outcome }) => outcome.state === "done"),
    adopted: sum((one) => one.adopted),
    settled: sum((one) => one.settled),
    unchanged: count(
      ({ outcome, removals }) => outcome.state === "unchanged" && !removals.includes(outcome.day),
    ),
    alreadyAbsent: count(
      ({ outcome, removals }) => outcome.state === "unchanged" && removals.includes(outcome.day),
    ),
    unsettled,
    refused: count(({ outcome }) => outcome.reason === "not_bookable"),
    unexpected: count(({ outcome }) => outcome.reason === "changed"),
    failed: count(({ outcome }) => outcome.reason === "unknown"),
    conflicts: new Set(outcomes.flatMap((one) => one.conflicts)).size,
    // Only for a calendar that takes no writes: the days left waiting for it.
    ...(readOnly ? { readOnly: unsettled } : {}),
  };
}

/**
 * Why the pass is a failure, or nothing. A calendar that takes no writes, with days waiting for it,
 * is `read_only`; a pass whose reads worked but whose sends did not has gone apart from it.
 */
function runError(counts: Record<string, number>, readOnly: boolean): string | undefined {
  if (readOnly && counts.unsettled > 0) return READ_ONLY;
  const lost = counts.failed + counts.unexpected;
  if (lost === 0) return undefined;
  return `${lost} of ${lost + counts.applied} changes did not reach Trek; they stay pending`;
}

/**
 * The calendar's figures, once per pass and for one year only — reading them persists carry-over
 * upstream — kept on the sync job's cursor so the Time off screen can show them beside our own.
 */
async function readFigures(
  ctx: Ctx,
  connection: Connection,
  calls: CalendarCalls,
  input: { year: number; now: Date },
) {
  const figures = await calls.figures(input.year).catch(() => null);
  if (figures !== null) {
    const cursor = {
      year: String(input.year),
      ...Object.fromEntries(Object.entries(figures).map(([key, value]) => [key, String(value)])),
    };
    await saveSyncJob(ctx, connection.id, "leave", { cursor, lastRunAt: input.now }, input.now);
  }
  return figures;
}

/** The years of a pass, one after the other; a write refused for permission makes the rest read-only. */
async function passYears(
  ctx: Ctx,
  calls: CalendarCalls,
  years: readonly number[],
  options: { now: Date; readOnly: boolean },
) {
  const outcomes: YearOutcome[] = [];
  let readOnly = options.readOnly;
  for (const year of years) {
    const outcome = await passYear(ctx, calls, year, { now: options.now, readOnly });
    outcomes.push(outcome);
    readOnly ||= outcome.outcomes.some((one) => one.reason === "permission");
  }
  return { outcomes, readOnly };
}

/**
 * The pass, with the lock already held. Writes exactly one `sync_runs` row, whatever the number of
 * years: a pass is a pass, and the log is what Settings › Integrations shows.
 */
async function trekPass(ctx: Ctx, connection: Connection, options: TrekSyncOptions): Promise<TrekSyncResult> {
  const now = options.now ?? new Date();
  const years = [...(options.years ?? (await yearsToCover(ctx, now)))];
  if (connection.state === "revoked") {
    // Recorded and skipped rather than silently not done: Settings › Integrations shows why the
    // calendar has stopped moving, and the message names the thing the owner can fix.
    const skipped = await recordRun(ctx, { connectionId: connection.id, kind: "leave" });
    await skipRun(ctx, skipped.id, REVOKED_REASON, now);
    return { years, counts: {}, figures: null, refused: "revoked", conflicts: [] };
  }

  const run = await recordRun(ctx, { connectionId: connection.id, kind: "leave" });
  try {
    const calls = options.calls ?? (await trekCalls(ctx, connection.id));
    // What `/verify` or an earlier pass found: a calendar that takes no writes is only read.
    const pass = await passYears(ctx, calls, years, { now, readOnly: connection.errorCode === READ_ONLY });
    const figures = await readFigures(ctx, connection, calls, { year: years.at(-1) ?? years[0], now });
    const counts = countsOf(pass.outcomes, pass.readOnly);
    const error = runError(counts, pass.readOnly);
    await finishRun(ctx, run.id, error === undefined ? { counts } : { counts, error }, now);
    const conflicts = [...new Set(pass.outcomes.flatMap((one) => one.conflicts))];
    return { years, counts, figures, refused: null, conflicts };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await finishRun(ctx, run.id, { counts: {}, error: message, cause: error }, now);
    if (isClientRefused(error)) await markConnection(ctx, connection.id, "revoked", message, now);
    throw error;
  }
}

/**
 * A pass for this user, if they have a Trek connection at all.
 *
 * One pass per user at a time (an advisory lock): "Sync now" pressed while the hourly tick is
 * running does not open a second one, it reports the one in flight. Without the lock two passes
 * would read the same year, plan the same toggles, and the second would undo the first.
 */
export async function syncTrekNow(ctx: Ctx, options: TrekSyncOptions = {}): Promise<TrekSyncResult | null> {
  const connection = await trekConnection(ctx);
  if (connection === null) return null;
  const outcome = await withJobLock(`${SYNC_LOCK_PREFIX}${ctx.userId}`, () =>
    trekPass(ctx, connection, options),
  );
  if (!outcome.ran) throw new TrekBusyError();
  return outcome.value;
}
