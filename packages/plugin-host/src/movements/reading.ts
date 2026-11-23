/**
 * The pass of the movements of a source (spec §9.1, §7.2): the categories reconciled first, then
 * one window at a time — fetch, apply, next — with the removal brake on every window it may judge.
 */
import { readSyncJob } from "@ledgerly/domain/platform/integrations";
import { today } from "@ledgerly/domain/shared/dates";
import { CREATED, linkedAccounts, type PassInput, REMOVED, SKIPPED, UPDATED } from "./accounts";
import type { SourceCategory } from "./calls";
import { type SourceCategoryWriter, syncSourceCategories } from "./categories";
import { saveReadThrough, windowsFor } from "./cursor";
import { toIncomingMovement } from "./incoming";
import { type IncomingMovement, movementsSink } from "./ports";
import { describeDoubt, RemovalRefusedError, removalDoubt } from "./removal";
import type { DateWindow } from "./windows";

/** Categories moved to the type their own movements say they are. */
const RETYPED = "categoriesRetyped";

/** What the movements pass knows besides the pass itself. */
interface MovementsInput extends PassInput {
  /** What the accounts pass proved present; `undefined` when it failed or was skipped. */
  covered: ReadonlySet<string> | undefined;
  categoryWriter: SourceCategoryWriter | null;
}

/** The state of one movements pass while it walks its windows. */
interface Walk {
  input: MovementsInput;
  judge: boolean;
  categories: ReadonlyMap<string, SourceCategory>;
  accounts: ReadonlyMap<string, { id: string }>;
  counts: Record<string, number>;
  doubts: string[];
}

/** The categories reconciled with the list just read, in both directions, and the list kept. */
async function reconcileCategories(
  input: MovementsInput,
  categories: ReadonlyMap<string, SourceCategory>,
  counts: Record<string, number>,
): Promise<void> {
  const { ctx, connection } = input;
  // The categories are reconciled with the list just read, in both directions, before a single
  // movement is written: a movement must never land on a category whose name this pass is about
  // to change, and the counts of that reconciliation belong to the same `sync_runs` row.
  const categorySync = await syncSourceCategories(ctx, {
    remote: [...categories.values()],
    writer: input.categoryWriter,
    provider: connection.provider,
  });
  Object.assign(counts, categorySync.counts);
  // The list as the source has it now, beside the categories it counts under here (N3.1): a new
  // one is added on its own and marked "New", and no reading waits for a choice.
  await movementsSink().recordSourceCategories(
    ctx,
    connection.provider,
    [...categories.values()]
      .filter((category) => !category.archived)
      .map((category) => ({
        externalId: category.externalId,
        name: category.name.trim(),
        groupName: category.groupName?.trim() || null,
      })),
  );
}

/** One window's answer, by local account: the movements, and the distinct ids it carried. */
async function readWindow(walk: Walk, window: DateWindow) {
  const rows = await walk.input.source.movements(window);
  const byAccount = new Map<string, IncomingMovement[]>();
  const returned = new Map<string, Set<string>>();
  for (const row of rows) {
    const accountId = walk.accounts.get(row.accountExternalId)?.id;
    if (accountId === undefined) {
      walk.counts[SKIPPED] += 1;
      continue;
    }
    const movements = byAccount.get(accountId) ?? [];
    movements.push(toIncomingMovement(row, walk.categories, walk.input.ctx.timeZone));
    byAccount.set(accountId, movements);
    const seen = returned.get(accountId) ?? new Set<string>();
    seen.add(row.externalId);
    returned.set(accountId, seen);
  }
  return { byAccount, returned };
}

/** The window an account's answer may judge, or `undefined`; a doubt is kept for the refusal. */
async function judgedWindow(
  walk: Walk,
  account: { externalId: string; id: string },
  window: DateWindow,
  carried: number,
): Promise<DateWindow | undefined> {
  if (!walk.judge || walk.input.covered?.has(account.externalId) !== true) return undefined;
  // Only the rows nothing has declared gone yet are at risk: `planUpstreamRemovals` writes
  // `removed_upstream_at` where it is still null and nowhere else.
  const stored = (await movementsSink().transactionsInWindow(walk.input.ctx, account.id, window)).filter(
    (row) => row.removedUpstreamAt === null,
  ).length;
  const doubt = removalDoubt(stored, carried);
  if (doubt === null) return window;
  walk.doubts.push(
    describeDoubt({ doubt, accountExternalId: account.externalId, window, stored, returned: carried }),
  );
  return undefined;
}

/** One window: fetched, then every linked account written, with the window where it may judge. */
async function passWindow(walk: Walk, window: DateWindow): Promise<void> {
  const { ctx, connection, now } = walk.input;
  const { byAccount, returned } = await readWindow(walk, window);
  for (const [externalId, account] of walk.accounts) {
    const carried = returned.get(account.id)?.size ?? 0;
    const judged = await judgedWindow(walk, { externalId, id: account.id }, window, carried);
    const outcome = await movementsSink().upsertFromProvider(
      ctx,
      account.id,
      byAccount.get(account.id) ?? [],
      {
        provider: connection.provider,
        now,
        window: judged,
      },
    );
    walk.counts[CREATED] += outcome.created;
    walk.counts[UPDATED] += outcome.updated;
    walk.counts[SKIPPED] += outcome.skipped;
    walk.counts[REMOVED] += outcome.removed;
  }
}

/**
 * Movements (spec §9.1, §7.2), one window at a time: fetch, apply, next. Nothing is held open
 * across a fetch, and the whole answer is never in memory at once.
 *
 * Every linked account is written for every window — a movement is imported whatever else is true
 * — but the **window** is a second, separate thing: passing it is what lets `upsertFromProvider`
 * declare gone a movement the window covered and the provider did not return (§7.2), and that is
 * the only destructive step of the engine. It is passed to an account only when two conditions
 * hold, and withheld silently otherwise:
 *
 * 1. `covered` says this answer's own `/accounts` read carried that account. An account the user
 *    deleted at the source stays in `linked` as `unavailable` for ever (§7.1 forbids deleting it),
 *    receives `[]` every hour, and would otherwise have its whole history hidden one window at a
 *    time — deleting it in all but name. `covered` is `undefined` when the accounts pass failed or
 *    was skipped: then nobody was proven present, so nobody's window is judged. Importing without
 *    removing is always safe; removing without knowing never is.
 * 2. {@link removalDoubt} finds the answer plausible for that account and window. When it does not,
 *    the window is withheld, everything the answer carried is still imported, and the pass ends by
 *    raising {@link RemovalRefusedError} — the same choice the plugin already makes for a page of
 *    `/accounts` and `/categories` that may be cut: a failed pass over silently wrong data.
 *
 * A movement on an account this app does not have is counted as skipped rather than dropped
 * silently: it means the accounts pass failed or the account arrived between the two reads.
 */
export async function syncTransactions(input: MovementsInput): Promise<Record<string, number>> {
  const { ctx, connection, source, now } = input;
  // The clock, not `now`: what this pass creates is stamped by the database (CR8).
  const passStart = new Date();
  const sink = movementsSink();
  const job = await readSyncJob(ctx, connection.id, "transactions");
  const day = today(ctx.timeZone, now);
  const read = windowsFor(job?.cursor ?? null, day);
  const categories = new Map((await source.categories()).map((category) => [category.externalId, category]));
  const accounts = await linkedAccounts(ctx, connection.provider);

  const counts: Record<string, number> = { [CREATED]: 0, [UPDATED]: 0, [SKIPPED]: 0, [REMOVED]: 0 };
  await reconcileCategories(input, categories, counts);
  const walk: Walk = { input, judge: read.judge, categories, accounts, counts, doubts: [] };
  for (const window of read.windows) await passWindow(walk, window);

  // What a trusted window declared gone is deleted, with its link (and so is anything an earlier
  // pass had only marked).
  await sink.purgeRemovedUpstream(ctx, { provider: connection.provider });

  // Everything the answers carried is written by now. The refusal comes here, before the cursor:
  // a pass whose verdict was not trusted is repeated whole rather than downgraded to seven days.
  if (walk.doubts.length > 0) throw new RemovalRefusedError(walk.doubts, counts);

  const through = { connectionId: connection.id, cursor: job?.cursor ?? null, read, day };
  await saveReadThrough(ctx, { ...through, anyAccount: accounts.size > 0 }, now);

  // Last, with this window's movements already in: the source publishes no type on a category, so
  // what is filed under one is the only thing that can say whether it is income, expense or a
  // transfer (owner, 2026-09-20). It runs after the import, never before, or it would judge on last
  // hour's evidence.
  counts[RETYPED] = await sink.alignCategoryTypesToMovements(ctx, passStart);

  return counts;
}
