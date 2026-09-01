/**
 * Queue order and neighbour maths for a verification run.
 *
 * Pure on purpose: the server page uses it for the position indicator and the
 * prev/next links, the client form uses it to decide where a confirm, a reject
 * or a skip lands. Both therefore agree on what "the next one" means, and the
 * rule is testable without a database.
 */

export interface QueueEntry {
  id: number;
  month: string;
  isThirteenth: boolean;
}

/**
 * Month ascending, then the ordinary payslip before that month's tredicesima.
 * `id` only breaks a tie that cannot happen today (the table is unique on
 * document + is_thirteenth) so the order is never left to insertion luck.
 */
function compare(a: QueueEntry, b: QueueEntry): number {
  if (a.month !== b.month) return a.month < b.month ? -1 : 1;
  if (a.isThirteenth !== b.isThirteenth) return a.isThirteenth ? 1 : -1;
  return a.id - b.id;
}

export function orderQueue<T extends QueueEntry>(entries: readonly T[]): T[] {
  return [...entries].sort(compare);
}

export interface QueuePlacement {
  total: number;
  /** 1-based position, or null when this payslip is no longer in the queue. */
  position: number | null;
  prev: QueueEntry | null;
  next: QueueEntry | null;
}

/** Where the payslip sits in the queue, for browsing without deciding. */
export function placeInQueue(
  entries: readonly QueueEntry[],
  currentId: number,
): QueuePlacement {
  const queue = orderQueue(entries);
  const index = queue.findIndex((entry) => entry.id === currentId);

  if (index === -1) {
    return { total: queue.length, position: null, prev: null, next: queue[0] ?? null };
  }
  return {
    total: queue.length,
    position: index + 1,
    prev: queue[index - 1] ?? null,
    next: queue[index + 1] ?? null,
  };
}

/**
 * The payslip to open once `current` has been dealt with: the next one still
 * pending, or — when `current` was the last of the run — the earliest one left
 * behind, so skipping never strands the ones already passed over. `remaining`
 * is the queue as the server sees it *after* the write, so a payslip verified
 * in another tab is never offered again.
 */
export function successorOf(
  remaining: readonly QueueEntry[],
  current: QueueEntry,
): number | null {
  const queue = orderQueue(remaining).filter((entry) => entry.id !== current.id);
  const after = queue.find((entry) => compare(entry, current) > 0);
  return after?.id ?? queue[queue.length - 1]?.id ?? null;
}

export function verifyHref(id: number): string {
  return `/work/verify/${id}`;
}
