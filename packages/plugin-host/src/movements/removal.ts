/**
 * The removal brake of the engine of a source (spec §7.2): how much of what is stored in a window
 * one answer is allowed to declare gone, and the refusal a pass ends with when an answer is not.
 */
import type { DateWindow } from "./windows";

/**
 * How much of what is stored in a window one answer is allowed to declare gone (spec §7.2's
 * disappearance, the only destructive step of the whole engine).
 *
 * One half, and the reasoning is about which two stories a count can tell apart. The answer we get
 * is trusted for three things at once — that it reached the source, that it asked for *this* window,
 * and that it carried *every* row of it — and only the third is guessed, from `page.length <
 * limit`. A provider that caps its own page size (100 while we ask 500) returns a **prefix** of the
 * truth, and a prefix of the truth overlaps heavily what previous full answers already stored: the
 * smaller the share of stored rows the answer still covers, the more it looks like a cut. Half is
 * where the two stories separate for the windows we actually read: seven days of an ordinary
 * account hold a handful of movements, so "one of two gone" (exactly the ceiling, allowed) stays
 * an ordinary deletion, while "two of nine gone" is a shape no one produces by deleting.
 *
 * The comparison is a **surrogate**: without resolving every external id to a local row this file
 * cannot know *which* stored movements the answer matched, only how many it brought. It is left as
 * a surrogate on purpose — `planUpstreamRemovals` in the transactions module is the single owner of
 * the removal rule (spec §4.3), and a second, exact copy of it here would be a second owner. The
 * surrogate is blind to one case only, an answer that replaced every id in the window with a
 * different one, which is not what truncation looks like and *is* a genuine wholesale deletion.
 */
export const MAX_WINDOW_REMOVAL_SHARE = 0.5;

/** Why one window's answer is not allowed to declare anything gone. */
type RemovalDoubt = "empty_answer" | "over_removal_ceiling";

/**
 * Whether an answer may be used as the window's verdict, from the two counts alone: how many
 * movements this account still has stored in the window that nothing has declared gone yet, and
 * how many distinct movements the answer carried for it.
 *
 * `empty_answer` is the case that cannot be told apart from "I did not answer you": a `200` with
 * zero rows and stored rows to lose says exactly what a silently truncated, mis-filtered or
 * server-emptied answer says. Nothing stored means nothing to lose, so an empty window over an
 * empty account is simply an empty window.
 */
export function removalDoubt(stored: number, returned: number): RemovalDoubt | null {
  if (stored <= 0) return null;
  if (returned <= 0) return "empty_answer";
  const removable = stored - returned;
  if (removable <= 0) return null;
  return removable / stored > MAX_WINDOW_REMOVAL_SHARE ? "over_removal_ceiling" : null;
}

/**
 * A pass that imported everything the answer brought and refused to hide anything (spec §7.2):
 * raised at the end of the movements pass so the run closes `failed` with the counts it really
 * wrote. The message names the account and the window, and carries no token and no movement.
 */
export class RemovalRefusedError extends Error {
  readonly code = "removal_refused";

  constructor(
    readonly doubts: readonly string[],
    readonly counts: Record<string, number> = {},
  ) {
    super(`refused to declare movements gone: ${doubts.join("; ")}`);
    this.name = "RemovalRefusedError";
  }
}

/** One window an answer may not judge, as the refusal names it. */
interface Doubted {
  doubt: RemovalDoubt;
  accountExternalId: string;
  window: DateWindow;
  stored: number;
  returned: number;
}

export function describeDoubt({ doubt, accountExternalId, window, stored, returned }: Doubted): string {
  const where = `account ${accountExternalId}, window ${window.from}..${window.to}`;
  return doubt === "empty_answer"
    ? `${where}: the answer carried no movement while ${stored} are stored`
    : `${where}: the answer carried ${returned} movements while ${stored} are stored, over the ${Math.round(
        MAX_WINDOW_REMOVAL_SHARE * 100,
      )}% ceiling`;
}
