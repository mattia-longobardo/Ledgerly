/**
 * Which windows a pass of a source reads, and what its cursor remembers of the reads done (spec
 * §9.1, F2.5): the backfill of a first link, the deep re-read of each day, the seven days of every
 * hour, and "Download the history again".
 */
import type { Ctx } from "@ledgerly/domain/platform/context";
import { readSyncJob, saveSyncJob } from "@ledgerly/domain/platform/integrations";
import { BACKFILL_MONTHS, backfillDepth, MAX_BACKFILL_MONTHS } from "./depth";
import { type DateWindow, firstLinkWindows, recentWindow } from "./windows";

/**
 * Where the first link records that it has happened (spec §9.1: twelve months once, seven days
 * every hour after that). It lives in `sync_jobs.cursor` for the `transactions` kind, so it
 * survives a failed pass — `finishRun` moves `last_run_at`/`next_run_at` and leaves the cursor
 * alone — and a backfill that broke half way is attempted again rather than silently downgraded
 * to a seven-day window.
 */
const BACKFILL_FROM = "backfilledFrom";
const BACKFILL_THROUGH = "backfilledThrough";

/**
 * The day of the last deep re-read: once a day — the first pass after midnight in the user's zone —
 * the hourly pass reads the last {@link DAILY_REREAD_MONTHS} whole months instead of seven days, so
 * a category or a note changed at the source on an older movement reaches the app by the next
 * morning (owner, 2026-10-19). A backfill counts as that day's deep re-read: it has just read more.
 */
const REREAD_ON = "rereadOn";
export const DAILY_REREAD_MONTHS = 3;

type Cursor = Record<string, string> | null;

/** What one pass reads, and how far it may judge. */
interface PassWindows {
  windows: DateWindow[];
  judge: boolean;
  deep: boolean;
}

/**
 * The windows one pass reads (spec §9.1): the monthly windows of a backfill the first time — twelve,
 * or the depth a re-download asked for (F2.5) — oldest first, and the last seven days every hour
 * after that, except the first pass of each day, which re-reads {@link DAILY_REREAD_MONTHS} months.
 * Which of the two it is depends on the cursor and on nothing else — not on whether rows exist,
 * which a user who deleted a connection and reconnected would make lie, and not on a clock.
 *
 * `judge` says whether the pass may declare a movement gone (F2.5): only the seven-day re-read
 * may. A backfill imports and nothing else. On a first link that changes nothing, because nothing
 * is stored yet; on a re-download of sixty months it is what keeps an answer the removal brake
 * would doubt from failing the pass, and the pass from hiding years of history on one bad read.
 */
export function windowsFor(cursor: Cursor, day: string): PassWindows {
  if (cursor?.[BACKFILL_FROM] === undefined) {
    return { windows: firstLinkWindows(day, backfillDepth(cursor)), judge: false, deep: false };
  }
  // The deep re-read only imports and updates, like a backfill: months of answers are not a
  // verdict on what is gone, and the seven-day pass of the next hour judges as always.
  if (cursor[REREAD_ON] !== day) {
    return { windows: firstLinkWindows(day, DAILY_REREAD_MONTHS), judge: false, deep: true };
  }
  return { windows: [recentWindow(day)], judge: true, deep: false };
}

/** What a pass that read every window writes on the cursor. */
interface ReadThrough {
  connectionId: string;
  cursor: Cursor;
  read: PassWindows;
  day: string;
  /** Whether there was an account to read the backfill into. */
  anyAccount: boolean;
}

/**
 * Written only once the whole backfill has been read, and only if there was an account to read
 * it into: a pass that threw half way, or one that ran before the accounts existed, leaves the
 * cursor absent and is repeated, instead of losing the twelve months it never imported.
 */
export async function saveReadThrough(
  ctx: Pick<Ctx, "userId">,
  through: ReadThrough,
  now: Date,
): Promise<void> {
  const { connectionId, cursor, read, day } = through;
  if (cursor?.[BACKFILL_FROM] === undefined && through.anyAccount) {
    const windows = read.windows;
    await saveSyncJob(
      ctx,
      connectionId,
      "transactions",
      {
        cursor: {
          ...cursor,
          [BACKFILL_FROM]: windows[0].from,
          [BACKFILL_THROUGH]: windows[windows.length - 1].to,
          [REREAD_ON]: day,
        },
      },
      now,
    );
  } else if (read.deep) {
    // Like the backfill's, written only once every window is in: a deep re-read that failed half
    // way is attempted again by the next hour's pass.
    await saveSyncJob(ctx, connectionId, "transactions", { cursor: { ...cursor, [REREAD_ON]: day } }, now);
  }
}

/**
 * "Download the history again" (spec §9.1, F2.5): the next pass of this connection is a backfill
 * of `months` monthly windows instead of the seven-day re-read. The cursor forgets how far the last
 * backfill went and remembers the depth asked for, so the backfill that follows reads exactly that
 * and, once it is through, the hourly passes go back to seven days. Nothing is read here: the
 * caller runs the pass (or leaves it to the hourly job).
 */
export async function requestSourceBackfill(
  ctx: Pick<Ctx, "userId">,
  connectionId: string,
  months: number,
): Promise<void> {
  if (!Number.isInteger(months) || months < 1 || months > MAX_BACKFILL_MONTHS) {
    throw new RangeError(`Not a backfill depth: ${months}`);
  }
  const job = await readSyncJob(ctx, connectionId, "transactions");
  const kept = Object.entries(job?.cursor ?? {}).filter(
    ([key]) => key !== BACKFILL_FROM && key !== BACKFILL_THROUGH,
  );
  await saveSyncJob(ctx, connectionId, "transactions", {
    cursor: { ...Object.fromEntries(kept), [BACKFILL_MONTHS]: String(months) },
  });
}
