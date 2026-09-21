/**
 * One pass of the Trek leave sync (spec §9.2, plan F7 §3.4.7): **write, then re-read, then
 * reconcile**.
 *
 *   1. read the year, to know what Trek holds *now*;
 *   2. `planToggles` — pure — reduces that to the fewest toggles;
 *   3. each toggle goes out once, never blind: a send that failed or whose outcome is unknown
 *      leaves `pending` exactly as it was, and the next pass tries again **after reading again**;
 *   4. read the year once more and reconcile: what Trek has and we do not becomes a row of ours,
 *      what we have and Trek does not stays `pending`;
 *   5. `get_vacay_stats` once, and only to show beside our own figures — reading it persists
 *      carry-over upstream, so it is not a read to make in a loop.
 *
 * A pass whose read worked but whose send did not is recorded `failed` and sends no mail: at an
 * hourly cadence that would be noise, and the staleness badge in Settings › Integrations is the
 * right signal (plan F7 §3.4.11). A user with no Trek connection writes no `sync_runs` row at all.
 */
import "server-only";
import { asTrekKind } from "@/modules/timeoff/rules";
import {
  datesHeld,
  markSynced,
  recordFromTrek,
  trekDaysOf,
  yearWindow,
  yearsWithPending,
  type Observed,
  type TrekDay,
} from "@/modules/timeoff/service";
import type { Ctx } from "@/platform/context";
import type { CivilDate } from "@/platform/dates";
import { today } from "@/platform/dates";
import { withJobLock } from "@/platform/jobs/lock";
import { TREK_PROVIDER } from "../rules";
import {
  finishRun,
  listConnections,
  markConnection,
  readCredentials,
  readSyncJob,
  recordRun,
  saveSyncJob,
  skipRun,
  type Connection,
} from "../service";
import {
  createTrekClient,
  isTokenRejected,
  planToggles,
  type DesiredDay,
  type TrekClient,
  type TrekConfig,
  type TrekClientOptions,
  type TrekEntry,
  type TrekFraction,
  type TrekYearStats,
  type ToggleResult,
} from "./client";

const SYNC_LOCK_PREFIX = "trek-sync:";
const REVOKED_REASON = "the Trek token has been rejected; reconnect Trek in Settings › Integrations";

/**
 * A pass that did not happen because one was already running for this user. Not a failure and not
 * a `sync_runs` row: nothing was attempted, so nothing is logged.
 */
export class TrekBusyError extends Error {
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

export interface TrekSyncResult {
  /** The years the pass covered. */
  years: number[];
  counts: Record<string, number>;
  /** Trek's own figures for the current year, as a cross-check; never our numbers (§3.6.4). */
  stats: TrekYearStats | null;
  /** `"revoked"` when nothing was attempted because the token is already refused. */
  refused: "revoked" | null;
  /**
   * Dates Trek holds a day on that we keep under a kind which never goes upstream — a `sick` day
   * against a Trek `vacation`, say. Reported, never resolved by guessing: our classification
   * wins, so the day is neither adopted nor overwritten (plan F7 §3.6.3).
   */
  conflicts: CivilDate[];
}

export interface TrekSyncOptions {
  now?: Date;
  /** Injected in tests, so a pass can run against the fake MCP server. */
  client?: TrekClient;
  clientOptions?: TrekClientOptions;
  /** Override the years covered; by default this year plus any year with something pending. */
  years?: readonly number[];
}

/** Trek's own figures, flattened into the string map `sync_jobs.cursor` stores. */
function statsAsCursor(stats: TrekYearStats, year: number): Record<string, string> {
  return {
    year: String(year),
    vacationDays: String(stats.vacationDays),
    carriedOver: String(stats.carriedOver),
    totalAvailable: String(stats.totalAvailable),
    used: String(stats.used),
    remaining: String(stats.remaining),
    compUsed: String(stats.compUsed),
    windowStart: stats.windowStart,
    windowEnd: stats.windowEnd,
  };
}

/** What a pass last heard Trek say about a year, or `null` if it has never been told. */
export async function trekStatsOf(
  ctx: Pick<Ctx, "userId">,
  year: number,
): Promise<{ used: number; remaining: number; totalAvailable: number } | null> {
  const connection = await trekConnection(ctx);
  if (connection === null) return null;
  const job = await readSyncJob(ctx, connection.id, "leave");
  const cursor = job?.cursor ?? null;
  if (cursor === null || cursor.year !== String(year)) return null;
  const numbers = {
    used: Number(cursor.used),
    remaining: Number(cursor.remaining),
    totalAvailable: Number(cursor.totalAvailable),
  };
  return Object.values(numbers).every((value) => Number.isFinite(value)) ? numbers : null;
}

/** The machine client as Settings sealed it (plan M0: OAuth 2.1, not the deprecated static token). */
function configOf(bag: Record<string, string>): TrekConfig {
  return {
    baseUrl: bag.baseUrl ?? "",
    clientId: bag.clientId ?? "",
    clientSecret: bag.clientSecret ?? "",
  };
}

export async function trekConnection(ctx: Pick<Ctx, "userId">): Promise<Connection | null> {
  return (await listConnections(ctx)).find((one) => one.provider === TREK_PROVIDER) ?? null;
}

/** What one year's reconciliation produced. */
interface YearOutcome {
  toggles: ToggleResult[];
  adopted: number;
  settled: number;
  /**
   * Days where our state and Trek's still do not agree once the pass is over. Not the same as the
   * `pending` column: a day we had settled and Trek has since lost counts here too, because the
   * next pass has work to do on it, and its column says `none`.
   */
  unsettled: number;
  conflicts: CivilDate[];
  unchanged: number;
  alreadyAbsent: number;
}

/** What one row is worth: half a day or a whole one, the only two a day off comes in (N0). */
function dayShare(day: TrekDay): TrekFraction {
  return day.fraction === 0.5 ? 0.5 : 1;
}

/**
 * The desired state of one year, and what must be taken back.
 *
 * Trek keeps one row per **date**; we keep one per date *and kind*. The two are reconciled by
 * **adding up**: half a day of ferie and half a day of ROL is one whole day away from the office,
 * and that is the one row Trek gets. The sum is capped at a whole day because that is the most a
 * Trek row can hold — a date booked past a full day is already odd, and sending 1.0 says the
 * truest thing Trek can be told about it rather than stalling the year over it.
 *
 * A date is a `removal` only once **nothing** of ours is left on it: while one half is still
 * wanted, Trek keeps its row and the desired day above simply shrinks it. The list stays explicit
 * and is never "whatever is missing from `desired`" (plan F7 §3.6.8).
 */
export function splitForTrek(days: readonly TrekDay[]): {
  desired: DesiredDay[];
  removals: CivilDate[];
} {
  const perDate = new Map<CivilDate, TrekDay[]>();
  for (const day of days) {
    if (day.pending === "delete") continue;
    perDate.set(day.on, [...(perDate.get(day.on) ?? []), day]);
  }

  const desired: DesiredDay[] = [];
  for (const [date, group] of perDate) {
    const share = group.reduce((sum, day) => sum + dayShare(day), 0);
    // Every kind that reaches Trek lands on the same one (N4), so the group's first row answers
    // for the whole of it: there is no kind left to choose between.
    desired.push({ date, fraction: share > 0.5 ? 1 : 0.5, kind: asTrekKind(group[0].kind) });
  }

  const removals = days
    .filter((day) => day.pending === "delete" && !perDate.has(day.on))
    .map((day) => day.on);
  return {
    desired: desired.sort((a, b) => (a.date < b.date ? -1 : 1)),
    removals: [...new Set(removals)].sort(),
  };
}

/** One year: read, plan, send, read again, write down what is now true. */
async function passYear(
  ctx: Pick<Ctx, "userId">,
  client: TrekClient,
  year: number,
  now: Date,
): Promise<YearOutcome> {
  const window = yearWindow(year);
  const days = await trekDaysOf(ctx, window);
  const { desired, removals } = splitForTrek(days);
  const wantedOn = new Map(desired.map((one) => [one.date, one]));
  const conflicts: CivilDate[] = [];

  const before = await client.getEntries(year);
  const plan = planToggles(before, desired, removals);

  const toggles: ToggleResult[] = [];
  for (const step of plan.steps) {
    // One attempt each, and the loop keeps going: a day Trek refuses is no reason to abandon the
    // rest of the year. What each one did is settled by the re-read below, not by its own answer.
    toggles.push(await client.toggleEntry(step));
  }

  // The truth, after the writes. Everything below is written from this and nothing else: a toggle
  // that said "added" and a toggle whose answer was lost are treated the same way, by looking.
  const after = toggles.length > 0 ? await client.getEntries(year) : before;
  const upstream = new Map<CivilDate, TrekEntry>();
  for (const entry of after) upstream.set(entry.date, entry);

  const observed: Observed[] = [];
  let unsettled = 0;
  for (const day of days) {
    const entry = upstream.get(day.on);
    const want = wantedOn.get(day.on);
    // Trek's row for this date, when it says exactly what this pass meant it to say. It is
    // compared against the **desired** day and not against the row's own kind and fraction: a
    // date carrying two halves of ours is one row of 1.0 upstream, and that single sighting is
    // what settles both of them.
    const agreed =
      want !== undefined &&
      entry !== undefined &&
      entry.kind === want.kind &&
      entry.fraction === want.fraction
        ? entry
        : null;

    if (day.pending === "delete") {
      // The row may finally go once Trek has stopped counting it: either the date is gone
      // upstream, or what is left of it is exactly the rest of the day, which this row is no
      // longer part of. Anything else and it stays pending for next time.
      const letGo = want === undefined ? entry === undefined : agreed !== null;
      if (letGo) observed.push({ id: day.id, fraction: null, kind: null });
      else unsettled += 1;
      continue;
    }

    if (agreed !== null) observed.push({ id: day.id, fraction: agreed.fraction, kind: agreed.kind });
    else unsettled += 1;
  }
  await markSynced(ctx, observed, now);

  // What Trek holds and we do not. A date we already hold under another kind is **not** adopted:
  // our classification wins and the day is left alone (plan F7 §3.6.3).
  const held = await datesHeld(ctx, window);
  const asked = new Set(removals);
  let adopted = 0;
  for (const entry of after) {
    if (wantedOn.has(entry.date)) continue;
    // A day we asked Trek to drop and it has not dropped yet is neither a conflict nor something
    // to adopt back: it is a removal that did not land, already counted in `unsettled`. Adopting
    // it would undo the person's own deletion at the next pass.
    if (asked.has(entry.date)) continue;
    if (held.has(entry.date)) {
      if (!conflicts.includes(entry.date)) conflicts.push(entry.date);
      continue;
    }
    await recordFromTrek(ctx, { on: entry.date, kind: entry.kind, fraction: entry.fraction }, now);
    adopted += 1;
  }

  return {
    toggles,
    adopted,
    settled: observed.length,
    unsettled,
    conflicts: conflicts.sort(),
    unchanged: plan.unchanged.length,
    alreadyAbsent: plan.alreadyAbsent.length,
  };
}

/** Which years a pass covers: the one we are in, plus any year with something still pending. */
async function yearsToCover(ctx: Pick<Ctx, "userId" | "timeZone">, now: Date): Promise<number[]> {
  const current = Number(today(ctx.timeZone, now).slice(0, 4));
  const pending = await yearsWithPending(ctx);
  return [...new Set([current, ...pending])].sort((a, b) => a - b);
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
    return { years, counts: {}, stats: null, refused: "revoked", conflicts: [] };
  }

  const client =
    options.client ??
    createTrekClient(configOf(await readCredentials(ctx, connection.id)), options.clientOptions);

  const run = await recordRun(ctx, { connectionId: connection.id, kind: "leave" });
  let applied = 0;
  let refusedByTrek = 0;
  let failed = 0;
  let unexpected = 0;
  let adopted = 0;
  let settled = 0;
  let unsettled = 0;
  let unchanged = 0;
  let alreadyAbsent = 0;
  const conflicts: CivilDate[] = [];

  try {
    for (const year of years) {
      const outcome = await passYear(ctx, client, year, now);
      for (const toggle of outcome.toggles) {
        if (toggle.outcome === "applied") applied += 1;
        else if (toggle.outcome === "weekend_blocked") refusedByTrek += 1;
        else if (toggle.outcome === "unexpected_action") unexpected += 1;
        else failed += 1;
      }
      adopted += outcome.adopted;
      settled += outcome.settled;
      unsettled += outcome.unsettled;
      unchanged += outcome.unchanged;
      alreadyAbsent += outcome.alreadyAbsent;
      for (const date of outcome.conflicts) if (!conflicts.includes(date)) conflicts.push(date);
    }

    // Once per pass, and for one year only: reading it persists carry-over upstream.
    const statsYear = years.at(-1) ?? years[0];
    const stats = await client.getStats(statsYear).catch(() => null);
    // Kept on the sync job's cursor so the Time off screen can show them beside our own figures
    // without opening a connection of its own. They are Trek's numbers and stay labelled as such:
    // they honour a leave-year window this app does not model (§3.6.4).
    if (stats !== null) {
      await saveSyncJob(
        ctx,
        connection.id,
        "leave",
        { cursor: statsAsCursor(stats, statsYear), lastRunAt: now },
        now,
      );
    }

    const counts = {
      applied,
      adopted,
      settled,
      unchanged,
      alreadyAbsent,
      unsettled,
      refused: refusedByTrek,
      unexpected,
      failed,
      conflicts: conflicts.length,
    };

    // A pass whose reads worked but whose sends did not is a failure: the two calendars have gone
    // apart, and the log has to say so even though nobody is mailed about it (§3.4.11).
    const error =
      failed + unexpected > 0
        ? `${failed + unexpected} of ${failed + unexpected + applied} changes did not reach Trek; they stay pending`
        : undefined;
    await finishRun(ctx, run.id, error === undefined ? { counts } : { counts, error }, now);
    return { years, counts, stats, refused: null, conflicts };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await finishRun(ctx, run.id, { counts: { applied, adopted, settled }, error: message }, now);
    if (isTokenRejected(error)) await markConnection(ctx, connection.id, "revoked", message, now);
    throw error;
  }
}

/**
 * A pass for this user, if they have a Trek connection at all.
 *
 * One pass per user at a time (an advisory lock, like `wallet-sync`): "Sync now" pressed while the
 * hourly tick is running does not open a second one, it reports the one in flight. Without the
 * lock two passes would read the same year, plan the same toggles, and the second would undo what
 * the first had just done — the toggle being its own inverse.
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
