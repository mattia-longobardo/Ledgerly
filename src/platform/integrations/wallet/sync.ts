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
import { applyProviderAccounts, saveProviderBalance } from "@/modules/accounts/service";
import type { IncomingTransaction, TransactionState, TransactionType } from "@/modules/transactions/rules";
import { upsertFromProvider } from "@/modules/transactions/service";
import type { Ctx } from "@/platform/context";
import { startOfDayIn, today } from "@/platform/dates";
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
  type WalletClient,
  type WalletClientOptions,
  type WalletTransaction,
  createWalletClient,
  isTokenRejected,
} from "./client";
import { type DateWindow, firstLinkWindows, recentWindow } from "./mapping";

/** The counts of one pass, per kind, as `sync_runs.counts` stores them. */
export interface WalletSyncResult {
  accounts: Record<string, number>;
  transactions: Record<string, number>;
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
 * 2. `occurredAt` is required there and optional here: a `recordDate` with no time becomes
 *    midnight of that day **in the user's own zone**, through `platform/dates.ts` and never
 *    through `toISOString()` (spec §4.3). That is the instant whose civil date the interface and
 *    `planUpstreamRemovals` read back, so the movement stays on the day Wallet stamped it;
 * 3. the provider's raw `recordType`/`recordState` become the local enums, and the category *name*
 *    comes from the `/categories` read — a movement carries only the id, and §9.1 adopts a
 *    category by its exact name.
 */
export function toIncomingTransaction(
  movement: WalletTransaction,
  categoryNames: ReadonlyMap<string, string>,
  timeZone: string,
): IncomingTransaction {
  const categoryExternalId = movement.categoryExternalId;
  return {
    externalId: movement.externalId,
    counterpartExternalId: movement.transferCounterExternalId,
    occurredAt: movement.occurredAt ?? startOfDayIn(movement.occurredOn, timeZone),
    amountCents: movement.amountCents,
    currency: movement.currency,
    type: walletTransactionType(movement),
    state: walletTransactionState(movement.providerState),
    payee: movement.payee,
    note: movement.note,
    categoryExternalId,
    categoryName: categoryExternalId === null ? null : (categoryNames.get(categoryExternalId) ?? null),
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
 */
async function syncAccounts(
  ctx: Pick<Ctx, "userId" | "timeZone">,
  client: WalletClient,
  now: Date,
): Promise<Record<string, number>> {
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
    [CREATED]: [...after.keys()].filter((externalId) => !before.has(externalId)).length,
    [UPDATED]: written,
    [SKIPPED]: unresolved,
    [REMOVED]: gone.length,
  };
}

/**
 * The windows one pass reads (spec §9.1): twelve monthly windows the first time, oldest first, and
 * the last seven days every hour after that. Which of the two it is depends on the cursor and on
 * nothing else — not on whether rows exist, which a user who deleted a connection and reconnected
 * would make lie, and not on a clock.
 */
function windowsFor(cursor: Record<string, string> | null, day: string): DateWindow[] {
  return cursor?.[BACKFILL_FROM] === undefined ? firstLinkWindows(day) : [recentWindow(day)];
}

/**
 * Movements (spec §9.1, §7.2), one window at a time: fetch, apply, next. Nothing is held open
 * across a fetch, and the whole answer is never in memory at once.
 *
 * Every linked account is asked about for every window, including the ones the answer said nothing
 * about — that is what lets `upsertFromProvider` notice a movement the window covered and the
 * provider did not return, which is the disappearance of §7.2. The window is passed on every pass,
 * the first link included: an answer that covered a date is entitled to say something is missing
 * from it, whether that answer was a month of a backfill or today's seven days.
 *
 * A movement on an account this app does not have is counted as skipped rather than dropped
 * silently: it means the accounts pass failed or the account arrived between the two reads.
 */
async function syncTransactions(
  ctx: Pick<Ctx, "userId" | "timeZone">,
  connectionId: string,
  client: WalletClient,
  now: Date,
): Promise<Record<string, number>> {
  const job = await readSyncJob(ctx, connectionId, "transactions");
  const windows = windowsFor(job?.cursor ?? null, today(ctx.timeZone, now));
  const categoryNames = new Map(
    (await client.categories()).map((category) => [category.externalId, category.name]),
  );
  const accounts = await linkedAccounts(ctx);

  const counts = { [CREATED]: 0, [UPDATED]: 0, [SKIPPED]: 0, [REMOVED]: 0 };
  for (const window of windows) {
    const rows = await client.transactions(window);
    const byAccount = new Map<string, IncomingTransaction[]>();
    for (const row of rows) {
      const accountId = accounts.get(row.accountExternalId);
      if (accountId === undefined) {
        counts[SKIPPED] += 1;
        continue;
      }
      const movements = byAccount.get(accountId) ?? [];
      movements.push(toIncomingTransaction(row, categoryNames, ctx.timeZone));
      byAccount.set(accountId, movements);
    }
    for (const accountId of accounts.values()) {
      const outcome = await upsertFromProvider(ctx, accountId, byAccount.get(accountId) ?? [], {
        provider: WALLET_PROVIDER,
        now,
        window,
      });
      counts[CREATED] += outcome.created;
      counts[UPDATED] += outcome.updated;
      counts[SKIPPED] += outcome.skipped;
      counts[REMOVED] += outcome.removed;
    }
  }

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
 *   `finishRun` that would claim the provider was asked anything;
 * - a token refused mid-pass (401/403) closes its run with the error **and then** marks the
 *   connection `revoked` — `finishRun` cannot tell a refused credential from a bad afternoon — and
 *   the kinds after it are skipped, because the credential is dead for all of them;
 * - anything else closes its run as failed and the next kind is still attempted: a window that
 *   came back truncated is no reason to leave the balances unread.
 *
 * The first failure is re-thrown once every kind has been dealt with, so the caller sees the real
 * error (a `WalletError`, which is how Settings › Integrations tells "token rejected" from
 * "unreachable") while the log already holds the whole pass.
 */
export async function syncWalletNow(
  ctx: Ctx,
  connectionId: string,
  options: WalletSyncOptions = {},
): Promise<WalletSyncResult> {
  const now = options.now ?? new Date();
  const connection = await walletConnection(ctx, connectionId);
  const result: WalletSyncResult = { accounts: {}, transactions: {} };

  if (connection.state === "revoked") {
    for (const kind of SYNC_KINDS) await skipKind(ctx, connectionId, kind, REVOKED_REASON, now);
    return result;
  }

  const client =
    options.client ?? createWalletClient(await walletToken(ctx, connectionId), options.clientOptions);
  let refused = false;
  let failure: unknown;

  for (const kind of SYNC_KINDS) {
    if (refused) {
      await skipKind(ctx, connectionId, kind, REVOKED_REASON, now);
      continue;
    }
    const run = await recordRun(ctx, { connectionId, kind });
    try {
      const counts =
        kind === "accounts"
          ? await syncAccounts(ctx, client, now)
          : await syncTransactions(ctx, connectionId, client, now);
      result[kind] = counts;
      await finishRun(ctx, run.id, { counts }, now);
    } catch (error) {
      const message = describeError(error);
      await finishRun(ctx, run.id, { counts: {}, error: message }, now);
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
