/**
 * The Wallet sync engine (spec §9.1, §10.2, §10.3): the one place that reads Budget Makers Wallet
 * and applies the answer.
 *
 * It lives in `platform/` because it coordinates *two* modules — accounts and transactions — and
 * it reaches each of them only through its own service: `applyProviderAccounts` and
 * `saveProviderBalance` for the accounts and their balances, `upsertFromProvider` for the
 * movements. No module's `schema.ts` is imported here, and none may be
 * (`src/architecture.test.ts`): a platform file that wrote a module's tables would be a second
 * owner of them.
 *
 * The separation of §4.3 is kept in both directions. `client.ts` speaks HTTP and never touches the
 * database; the services write the database and never touch the network; this file fetches first
 * and applies afterwards, so no provider call ever happens inside a transaction.
 *
 * Every pass is recorded in `sync_runs`, one row per {@link SyncKind} — "Sync now" included, which
 * is the trace Settings › Integrations reads (spec §10.3).
 */
import "server-only";
import { listAccounts } from "@/modules/accounts/queries";
import type { RemoteAccount } from "@/modules/accounts/rules";
import {
  applyProviderAccounts,
  rebuildDerivedBalances,
  saveProviderBalance,
} from "@/modules/accounts/service";
import { transactionsInWindow } from "@/modules/transactions/queries";
import type { IncomingTransaction, TransactionState, TransactionType } from "@/modules/transactions/rules";
import { upsertFromProvider } from "@/modules/transactions/service";
import type { Ctx } from "@/platform/context";
import { civilDateIn, startOfDayIn, today } from "@/platform/dates";
import { withJobLock } from "@/platform/jobs/lock";
import { SYNC_KINDS, type SyncKind, WALLET_PROVIDER } from "../rules";
import {
  type Connection,
  IntegrationError,
  finishRun,
  listConnections,
  markConnection,
  readCredentials,
  readSyncJob,
  recordRun,
  saveSyncJob,
  skipRun,
} from "../service";
import {
  type WalletAccount,
  type WalletCategory,
  type WalletClient,
  type WalletClientOptions,
  type WalletTransaction,
  createWalletClient,
  isTokenRejected,
} from "./client";
import { BACKFILL_MONTHS, backfillDepth, MAX_BACKFILL_MONTHS } from "./depth";
import { type DateWindow, firstLinkWindows, recentWindow } from "./mapping";

/** The counts of one pass, per kind, as `sync_runs.counts` stores them. */
export interface WalletSyncResult {
  accounts: Record<string, number>;
  transactions: Record<string, number>;
  /**
   * `"revoked"` when the pass attempted nothing at all because the token is already refused: both
   * kinds were recorded and skipped and no call was made. `null` when the provider was really
   * asked something, whatever the answer was.
   *
   * It is stated here, by the only code that knows, because a caller cannot tell the two apart
   * from the counts: a refused connection and a pass that found nothing new both come back empty.
   * Counting the first as a pass is how §10.4's "failed sync" gets reported as "out of date".
   */
  refused: "revoked" | null;
}

export interface WalletSyncOptions {
  now?: Date;
  /** Injected in tests: there is no Wallet token to call the real API with (spec §10, owner's). */
  client?: WalletClient;
  /** Passed to {@link createWalletClient} when no client is injected. */
  clientOptions?: WalletClientOptions;
}

/**
 * The keys the run catalogue translates. Anything a pass wants to say has to be said in these
 * four, so the history reads the same for every kind and every provider.
 */
const CREATED = "created";
const UPDATED = "updated";
const SKIPPED = "skipped";
const REMOVED = "removed";

/**
 * Why a run was skipped, as `sync_runs.error` keeps it: one short line, the same vocabulary §9.1
 * uses ("token rifiutato"). The column holds provider diagnostics, not catalogued prose — the card
 * shows it verbatim beside Wallet's own messages.
 */
const REVOKED_REASON = "token rejected";

/** One advisory lock per connection, not per job name: `wallet-sync` guards the hourly job as a
 * whole, this guards one connection against its own second pass. */
const SYNC_LOCK_PREFIX = "wallet-sync:";

/* The two refusals of this engine */

/**
 * A pass that did not happen: another pass was already running on the same connection, so this one
 * opened no `sync_runs` row at all — "already running" is not an execution, and a log that
 * recorded it would claim the provider was asked something.
 *
 * It lives here, and not as an `IntegrationError` code, because the lock is this engine's own
 * business: every caller of {@link syncWalletNow} — the hourly job and "Sync now" alike (spec
 * §10.3) — goes through it, and each tells it apart from a real failure with {@link isSyncBusy}.
 */
export class SyncBusyError extends Error {
  readonly code = "busy";

  constructor(message = "a Wallet pass is already running on this connection") {
    super(message);
    this.name = "SyncBusyError";
  }
}

export function isSyncBusy(error: unknown): boolean {
  // The `name` arm holds where `instanceof` cannot: a Next.js build can load this module twice (a
  // Server Action bundle and a job bundle), and the same class is then two classes.
  return error instanceof SyncBusyError || (error instanceof Error && error.name === "SyncBusyError");
}

/**
 * How much of what is stored in a window one answer is allowed to declare gone (spec §7.2's
 * disappearance, the only destructive step of the whole engine).
 *
 * One half, and the reasoning is about which two stories a count can tell apart. The answer we get
 * is trusted for three things at once — that it reached Wallet, that it asked for *this* window,
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
export type RemovalDoubt = "empty_answer" | "over_removal_ceiling";

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

function describeDoubt(
  doubt: RemovalDoubt,
  accountExternalId: string,
  window: DateWindow,
  stored: number,
  returned: number,
): string {
  const where = `account ${accountExternalId}, window ${window.from}..${window.to}`;
  return doubt === "empty_answer"
    ? `${where}: the answer carried no movement while ${stored} are stored`
    : `${where}: the answer carried ${returned} movements while ${stored} are stored, over the ${Math.round(
        MAX_WINDOW_REMOVAL_SHARE * 100,
      )}% ceiling`;
}

/**
 * Where the first link records that it has happened (spec §9.1: twelve months once, seven days
 * every hour after that). It lives in `sync_jobs.cursor` for the `transactions` kind, so it
 * survives a failed pass — `finishRun` moves `last_run_at`/`next_run_at` and leaves the cursor
 * alone — and a backfill that broke half way is attempted again rather than silently downgraded
 * to a seven-day window.
 */
const BACKFILL_FROM = "backfilledFrom";
const BACKFILL_THROUGH = "backfilledThrough";

/* The bridge to the modules' own vocabularies */

/**
 * Wallet's `recordType`, in this app's words. Only the named types decide anything: an unknown or
 * absent type falls back to the sign, which is what `resolveType` (T3) would conclude anyway, and
 * a movement with a counterpart becomes a transfer there whatever this function said.
 */
const TYPE_BY_PROVIDER_TYPE: Record<string, TransactionType> = {
  expense: "expense",
  withdrawal: "expense",
  debit: "expense",
  income: "income",
  deposit: "income",
  credit: "income",
  transfer: "transfer",
};

/**
 * Wallet's `recordState`, in this app's two states. An unrecognised state is `cleared`, the
 * column's own default: a movement Wallet has is a movement that happened, and calling it pending
 * on a word this app does not know would keep it out of nothing while looking like a fact.
 */
const STATE_BY_PROVIDER_STATE: Record<string, TransactionState> = {
  cleared: "cleared",
  reconciled: "cleared",
  settled: "cleared",
  posted: "cleared",
  pending: "pending",
  uncleared: "pending",
  planned: "pending",
};

export function walletTransactionType(
  movement: Pick<WalletTransaction, "providerType" | "amountCents">,
): TransactionType {
  const named = movement.providerType === null ? undefined : TYPE_BY_PROVIDER_TYPE[movement.providerType];
  if (named) return named;
  return movement.amountCents < 0n ? "expense" : "income";
}

export function walletTransactionState(providerState: string | null): TransactionState {
  return (providerState === null ? undefined : STATE_BY_PROVIDER_STATE[providerState]) ?? "cleared";
}

/**
 * A Wallet movement as the transactions module receives it (spec §7.2). Three things are this
 * file's own work, because the two shapes do not line up:
 *
 * 1. `transferCounterExternalId` is the module's `counterpartExternalId` — one name for the
 *    reference transfers are paired on, whatever provider gave it;
 * 2. `occurredAt` is required there and optional here, and one invariant decides it — see
 *    {@link occurredAtOf}: the civil date the app reads back from the stored instant is **always**
 *    `occurredOn`, the day Wallet itself stamped;
 * 3. the provider's raw `recordType`/`recordState` become the local enums, and the category *name*
 *    comes from the `/categories` read — a movement carries only the id, and §9.1 adopts a
 *    category by its exact name.
 */
/**
 * The instant to store, under one invariant: `civilDateIn(occurredAtOf(movement, tz), tz)` is
 * `movement.occurredOn`, in every zone, always.
 *
 * `occurredOn` is the day Wallet stamped and the only day the provider will filter a window on;
 * the instant is a refinement of it, useful for ordering inside a day. The two can disagree —
 * `2026-01-20T23:40:00Z` is the 21st in Rome and the 20th to Wallet, and west of Greenwich the
 * drift goes the other way — and nothing can reconcile them afterwards, because `occurredOn` is
 * persisted nowhere (spec §9 allows F2 one migration, and it is spent). So when the instant
 * disagrees with its own day it is dropped in favour of midnight of `occurredOn` in the user's
 * zone: a lost time of day costs an ordering inside one day, while a wrong day moves the movement
 * to another month in the interface and — worse — out of the window Wallet filters on, where it
 * would be declared gone every hour (spec §7.2).
 */
export function occurredAtOf(
  movement: Pick<WalletTransaction, "occurredAt" | "occurredOn">,
  timeZone: string,
): Date {
  if (movement.occurredAt === null) return startOfDayIn(movement.occurredOn, timeZone);
  return civilDateIn(movement.occurredAt, timeZone) === movement.occurredOn
    ? movement.occurredAt
    : startOfDayIn(movement.occurredOn, timeZone);
}

export function toIncomingTransaction(
  movement: WalletTransaction,
  categories: ReadonlyMap<string, WalletCategory>,
  timeZone: string,
): IncomingTransaction {
  const categoryExternalId = movement.categoryExternalId;
  // The record carries its own category — name and group — (measured at the collaudo), so it is
  // preferred whole: it also covers a category created between the `/categories` read and this
  // window, and a record saying "no group" is fresher than the list. The list is the fallback for a
  // record that carries the id alone.
  const listed = categoryExternalId === null ? undefined : categories.get(categoryExternalId);
  const fromRecord = movement.categoryName !== null;
  return {
    externalId: movement.externalId,
    counterpartExternalId: movement.transferCounterExternalId,
    occurredAt: occurredAtOf(movement, timeZone),
    amountCents: movement.amountCents,
    currency: movement.currency,
    type: walletTransactionType(movement),
    state: walletTransactionState(movement.providerState),
    payee: movement.payee,
    note: movement.note,
    categoryExternalId,
    categoryName: fromRecord ? movement.categoryName : (listed?.name ?? null),
    categoryGroupExternalId: fromRecord
      ? movement.categoryGroupExternalId
      : (listed?.groupExternalId ?? null),
    categoryGroupName: fromRecord ? movement.categoryGroupName : (listed?.groupName ?? null),
    labels: movement.labels,
  };
}

/** A Wallet account as the accounts module's lifecycle rules receive it (spec §7.1). */
export function toRemoteAccount(account: WalletAccount): RemoteAccount {
  return {
    provider: WALLET_PROVIDER,
    providerAccountId: account.externalId,
    name: account.name,
    type: account.type,
    currency: account.currency,
  };
}

/* Runs */

async function walletConnection(ctx: Pick<Ctx, "userId">, connectionId: string): Promise<Connection> {
  const connection = (await listConnections(ctx)).find((one) => one.id === connectionId);
  if (!connection) throw new IntegrationError("not_found");
  if (connection.provider !== WALLET_PROVIDER) throw new IntegrationError("unknown_provider");
  return connection;
}

async function walletToken(ctx: Pick<Ctx, "userId">, connectionId: string): Promise<string> {
  const { token } = await readCredentials(ctx, connectionId);
  if (!token || token.trim() === "") throw new IntegrationError("invalid_credentials");
  return token;
}

/** A run opened and closed as skipped: recorded, because "nothing was attempted" is an answer. */
async function skipKind(
  ctx: Pick<Ctx, "userId">,
  connectionId: string,
  kind: SyncKind,
  reason: string,
  now: Date,
): Promise<void> {
  const run = await recordRun(ctx, { connectionId, kind });
  await skipRun(ctx, run.id, reason, now);
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The local accounts this provider owns, by the provider's own id. Archived ones included: they
 * are still the provider's accounts, and leaving them out would create a second row for each. */
async function linkedAccounts(ctx: Pick<Ctx, "userId">): Promise<Map<string, string>> {
  const rows = await listAccounts(ctx, { includeArchived: true });
  const byExternalId = new Map<string, string>();
  for (const account of rows) {
    if (account.provider !== WALLET_PROVIDER || account.providerAccountId === null) continue;
    byExternalId.set(account.providerAccountId, account.id);
  }
  return byExternalId;
}

/** What the accounts pass leaves behind: its counts, and the provider ids its answer carried. */
interface AccountsPass {
  counts: Record<string, number>;
  present: ReadonlySet<string>;
}

/**
 * Accounts and balances (spec §9.1: both, every hour).
 *
 * The two reads are the same `/accounts` call seen twice — Wallet publishes the balance inside the
 * account — and both happen before anything is written. `applyProviderAccounts` then decides the
 * lifecycle of §7.1 (adopt once, follow a rename, keep an archived account archived, mark a
 * vanished one `unavailable`), and each balance is stamped with the civil date of *this reading in
 * the user's own zone*, which is the one thing the client cannot know.
 *
 * An archived Wallet account is still an account the provider returned, so it counts as present:
 * "gone from the provider" is reserved for an account that stopped being returned at all.
 *
 * The pass also reports **which** of the provider's accounts this answer carried, because it is the
 * only place that knows: the movements pass needs it to decide whose window it is entitled to judge
 * (spec §7.1 — a vanished account is never deleted, and hiding its movements would delete it).
 */
async function syncAccounts(
  ctx: Pick<Ctx, "userId" | "timeZone">,
  client: WalletClient,
  now: Date,
): Promise<AccountsPass> {
  const remote = await client.accounts();
  const balances = await client.balances();

  const before = await linkedAccounts(ctx);
  await applyProviderAccounts(ctx, WALLET_PROVIDER, remote.map(toRemoteAccount), now);
  const after = await linkedAccounts(ctx);

  const on = today(ctx.timeZone, now);
  let written = 0;
  let unresolved = 0;
  for (const balance of balances) {
    const accountId = after.get(balance.accountExternalId);
    if (accountId === undefined) {
      unresolved += 1;
      continue;
    }
    await saveProviderBalance(
      ctx,
      accountId,
      { on, cents: balance.cents, availableCents: balance.availableCents },
      now,
    );
    written += 1;
  }

  const present = new Set(remote.map((account) => account.externalId));
  const gone = [...before.keys()].filter((externalId) => !present.has(externalId));
  return {
    counts: {
      [CREATED]: [...after.keys()].filter((externalId) => !before.has(externalId)).length,
      [UPDATED]: written,
      [SKIPPED]: unresolved,
      [REMOVED]: gone.length,
    },
    present,
  };
}

/**
 * The windows one pass reads (spec §9.1): the monthly windows of a backfill the first time — twelve,
 * or the depth a re-download asked for (F2.5) — oldest first, and the last seven days every hour
 * after that. Which of the two it is depends on the cursor and on nothing else — not on whether
 * rows exist, which a user who deleted a connection and reconnected would make lie, and not on a
 * clock.
 *
 * `judge` says whether the pass may declare a movement gone (F2.5): only the seven-day re-read
 * may. A backfill imports and nothing else. On a first link that changes nothing, because nothing
 * is stored yet; on a re-download of sixty months it is what keeps an answer the removal brake
 * would doubt from failing the pass, and the pass from hiding years of history on one bad read.
 */
function windowsFor(
  cursor: Record<string, string> | null,
  day: string,
): { windows: DateWindow[]; judge: boolean } {
  if (cursor?.[BACKFILL_FROM] !== undefined) return { windows: [recentWindow(day)], judge: true };
  return { windows: firstLinkWindows(day, backfillDepth(cursor)), judge: false };
}

/**
 * "Download the history again" (spec §9.1, F2.5): the next pass of this connection is a backfill
 * of `months` monthly windows instead of the seven-day re-read. The cursor forgets how far the last
 * backfill went and remembers the depth asked for, so the backfill that follows reads exactly that
 * and, once it is through, the hourly passes go back to seven days. Nothing is read here: the
 * caller runs the pass (or leaves it to the hourly job).
 */
export async function requestWalletBackfill(
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
 * 1. `covered` says this answer's own `/accounts` read carried that account. A Wallet account the
 *    user deleted stays in `linked` as `unavailable` for ever (§7.1 forbids deleting it), receives
 *    `[]` every hour, and would otherwise have its whole history hidden one window at a time —
 *    deleting it in all but name. `covered` is `undefined` when the accounts pass failed or was
 *    skipped: then nobody was proven present, so nobody's window is judged. Importing without
 *    removing is always safe; removing without knowing never is.
 * 2. {@link removalDoubt} finds the answer plausible for that account and window. When it does not,
 *    the window is withheld, everything the answer carried is still imported, and the pass ends by
 *    raising {@link RemovalRefusedError} — the same choice `assertWholePage` already makes for
 *    `/accounts` and `/categories`: a failed pass over silently wrong data.
 *
 * A movement on an account this app does not have is counted as skipped rather than dropped
 * silently: it means the accounts pass failed or the account arrived between the two reads.
 */
async function syncTransactions(
  ctx: Pick<Ctx, "userId" | "timeZone">,
  connectionId: string,
  client: WalletClient,
  now: Date,
  covered: ReadonlySet<string> | undefined,
): Promise<Record<string, number>> {
  const job = await readSyncJob(ctx, connectionId, "transactions");
  const { windows, judge } = windowsFor(job?.cursor ?? null, today(ctx.timeZone, now));
  const categories = new Map((await client.categories()).map((category) => [category.externalId, category]));
  const accounts = await linkedAccounts(ctx);

  const counts = { [CREATED]: 0, [UPDATED]: 0, [SKIPPED]: 0, [REMOVED]: 0 };
  const doubts: string[] = [];
  for (const window of windows) {
    const rows = await client.transactions(window);
    const byAccount = new Map<string, IncomingTransaction[]>();
    const returned = new Map<string, Set<string>>();
    for (const row of rows) {
      const accountId = accounts.get(row.accountExternalId);
      if (accountId === undefined) {
        counts[SKIPPED] += 1;
        continue;
      }
      const movements = byAccount.get(accountId) ?? [];
      movements.push(toIncomingTransaction(row, categories, ctx.timeZone));
      byAccount.set(accountId, movements);
      const seen = returned.get(accountId) ?? new Set<string>();
      seen.add(row.externalId);
      returned.set(accountId, seen);
    }
    for (const [accountExternalId, accountId] of accounts) {
      let judged: DateWindow | undefined;
      if (judge && covered?.has(accountExternalId) === true) {
        // Only the rows nothing has declared gone yet are at risk: `planUpstreamRemovals` writes
        // `removed_upstream_at` where it is still null and nowhere else.
        const stored = (await transactionsInWindow(ctx, accountId, window)).filter(
          (row) => row.removedUpstreamAt === null,
        ).length;
        const carried = returned.get(accountId)?.size ?? 0;
        const doubt = removalDoubt(stored, carried);
        if (doubt === null) judged = window;
        else doubts.push(describeDoubt(doubt, accountExternalId, window, stored, carried));
      }
      const outcome = await upsertFromProvider(ctx, accountId, byAccount.get(accountId) ?? [], {
        provider: WALLET_PROVIDER,
        now,
        window: judged,
      });
      counts[CREATED] += outcome.created;
      counts[UPDATED] += outcome.updated;
      counts[SKIPPED] += outcome.skipped;
      counts[REMOVED] += outcome.removed;
    }
  }

  // Everything the answers carried is written by now. The refusal comes here, before the cursor:
  // a pass whose verdict was not trusted is repeated whole rather than downgraded to seven days.
  if (doubts.length > 0) throw new RemovalRefusedError(doubts, counts);

  // Written only once the whole backfill has been read, and only if there was an account to read
  // it into: a pass that threw half way, or one that ran before the accounts existed, leaves the
  // cursor absent and is repeated, instead of losing the twelve months it never imported.
  if (job?.cursor?.[BACKFILL_FROM] === undefined && accounts.size > 0) {
    await saveSyncJob(
      ctx,
      connectionId,
      "transactions",
      {
        cursor: {
          ...job?.cursor,
          [BACKFILL_FROM]: windows[0].from,
          [BACKFILL_THROUGH]: windows[windows.length - 1].to,
        },
      },
      now,
    );
  }

  return counts;
}

/**
 * One whole pass over a connection: accounts and balances, then movements (spec §10.2's order),
 * each with its own `sync_runs` row. This is what "Sync now" calls and what the hourly job calls,
 * so a manual sync leaves exactly the same trace as a scheduled one.
 *
 * The three outcomes T1 and I agreed on:
 * - a connection already `revoked` attempts nothing: each kind is recorded and skipped, without a
 *   `finishRun` that would claim the provider was asked anything, and the result says
 *   `refused: "revoked"` so no caller can count it as a pass that happened;
 * - a token refused mid-pass (401/403) closes its run with the error **and then** marks the
 *   connection `revoked` — `finishRun` cannot tell a refused credential from a bad afternoon — and
 *   the kinds after it are skipped, because the credential is dead for all of them;
 * - anything else closes its run as failed and the next kind is still attempted: a window that
 *   came back truncated is no reason to leave the balances unread.
 *
 * The first failure is re-thrown once every kind has been dealt with, so the caller sees the real
 * error (a `WalletError`, which is how Settings › Integrations tells "token rejected" from
 * "unreachable") while the log already holds the whole pass.
 *
 * The whole pass runs under one advisory lock per connection, so "Sync now" and the hourly job can
 * never overlap on it: the lock is here and not in the Server Action because both callers go
 * through this function, and two concurrent passes write two `transactions` rows for one Wallet
 * movement (`linkExternal` upserts on the external key and rewrites `entity_id`, so the second
 * pass succeeds and the first row is orphaned, then labelled gone from the provider for ever).
 * A caller that does not get the lock gets {@link SyncBusyError} and no `sync_runs` row.
 */
export async function syncWalletNow(
  ctx: Ctx,
  connectionId: string,
  options: WalletSyncOptions = {},
): Promise<WalletSyncResult> {
  const outcome = await withJobLock(`${SYNC_LOCK_PREFIX}${connectionId}`, () =>
    walletPass(ctx, connectionId, options),
  );
  if (!outcome.ran) throw new SyncBusyError();
  return outcome.value;
}

/** One pass, with the lock already held. */
async function walletPass(
  ctx: Ctx,
  connectionId: string,
  options: WalletSyncOptions,
): Promise<WalletSyncResult> {
  const now = options.now ?? new Date();
  const connection = await walletConnection(ctx, connectionId);
  const result: WalletSyncResult = { accounts: {}, transactions: {}, refused: null };

  if (connection.state === "revoked") {
    for (const kind of SYNC_KINDS) await skipKind(ctx, connectionId, kind, REVOKED_REASON, now);
    return { ...result, refused: "revoked" };
  }

  const client =
    options.client ?? createWalletClient(await walletToken(ctx, connectionId), options.clientOptions);
  let refused = false;
  let failure: unknown;
  // What the accounts pass proved present, and therefore whose window the movements pass may
  // judge. It stays `undefined` if that pass failed or was skipped: nothing was proven.
  let covered: ReadonlySet<string> | undefined;

  for (const kind of SYNC_KINDS) {
    if (refused) {
      await skipKind(ctx, connectionId, kind, REVOKED_REASON, now);
      continue;
    }
    const run = await recordRun(ctx, { connectionId, kind });
    try {
      let counts: Record<string, number>;
      if (kind === "accounts") {
        const pass = await syncAccounts(ctx, client, now);
        covered = pass.present;
        counts = pass.counts;
      } else {
        counts = await syncTransactions(ctx, connectionId, client, now, covered);
      }
      result[kind] = counts;
      await finishRun(ctx, run.id, { counts }, now);
      // The movements are in: the month ends of the synced accounts are rebuilt from them (spec
      // §7.1, F2.5). After the reads, with nothing held open; a failure here fails the pass like
      // any other, because a chart standing on stale rebuilt ends is a wrong answer.
      if (kind === "transactions") await rebuildDerivedBalances(ctx);
    } catch (error) {
      const message = describeError(error);
      // A refused verdict still imported everything it read: the run says so, and says why.
      const counts = error instanceof RemovalRefusedError ? error.counts : {};
      await finishRun(ctx, run.id, { counts, error: message }, now);
      if (isTokenRejected(error)) {
        await markConnection(ctx, connectionId, "revoked", message, now);
        refused = true;
      }
      failure ??= error;
    }
  }

  if (failure !== undefined) throw failure;
  return result;
}
