/**
 * The engine of a source read with a token (spec §9.1, §10.2, §10.3; rewrite plan R5c): the one
 * place that reads a plugin with the capability `source.read` and applies the answer.
 *
 * It coordinates *two* modules — accounts and transactions — and it reaches each of them only
 * through its own services, by the port of `ports.ts` the application wires: `applyProviderAccounts`
 * and `saveProviderBalance` for the accounts and their balances, `upsertFromProvider` for the
 * movements. No module's tables are reached from here, and none may be: a file that wrote a
 * module's tables would be a second owner of them.
 *
 * The separation of §4.3 is kept in both directions. The plugin speaks to the source, reached
 * through the calls of `calls.ts`, and never touches the database; the services write the database
 * and never touch the network; this file fetches first and applies afterwards, so no provider call
 * ever happens inside a transaction.
 *
 * Every pass is recorded in `sync_runs`, one row per kind — "Sync now" included, which is the trace
 * Settings › Integrations reads (spec §10.3).
 */
import type { Ctx } from "@ledgerly/domain/platform/context";
import {
  finishRun,
  markConnection,
  PLUGIN_KINDS,
  recordRun,
  skipRun,
  type SyncKind,
} from "@ledgerly/domain/platform/integrations";
import { withJobLock } from "@ledgerly/domain/platform/jobs";
import { isPassBusy, PassBusyError } from "../busy";
import { providerCan } from "../capabilities";
import { isTokenRefused, type SourceCalls, connectionSource } from "./calls";
import { linkedAccounts, type PassInput, sourceConnection, syncAccounts } from "./accounts";
import { categoryWriterOf, type SourceCategoryWriter } from "./categories";
import { movementsSink } from "./ports";
import { syncTransactions } from "./reading";
import { RemovalRefusedError } from "./removal";
import { type SendOutcome, sendManualMovements } from "./send";

/** The counts of one pass, per kind, as `sync_runs.counts` stores them. */
export interface SourceSyncResult {
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

interface SourceSyncOptions {
  now?: Date;
  /**
   * Injected in tests: the plugin served in-process on a stubbed source (spec §10, owner's). The
   * calls of the connection's own credentials otherwise.
   */
  source?: SourceCalls;
  /**
   * Who writes the categories back to the source. Injected in tests; the source's own calls when
   * its plugin has the capability `categories`. `null` keeps the pass read-only on that side — the
   * source → here half still runs.
   */
  categoryWriter?: SourceCategoryWriter | null;
}

/** Manual movements written to the source by this pass, and the ones it could not write (N3.1). */
const SENT = "sent";
const NOT_SENT = "notSent";

/**
 * Why a run was skipped, as `sync_runs.error` keeps it: one short line, the same vocabulary §9.1
 * uses ("token rifiutato"). The column holds provider diagnostics, not catalogued prose — the card
 * shows it verbatim beside the source's own messages.
 */
const REVOKED_REASON = "token rejected";

/** One advisory lock per connection, not per job name: it guards one connection against its own
 * second pass. */
const SYNC_LOCK_PREFIX = "source-sync:";

/** A pass of the source that did not happen, because another was running on the connection. */
export class SyncBusyError extends PassBusyError {
  constructor() {
    super("a pass of the source is already running on this connection");
  }
}

export const isSyncBusy = isPassBusy;

/** A run opened and closed as skipped: recorded, because "nothing was attempted" is an answer. */
async function skipKind(
  ctx: Pick<Ctx, "userId">,
  connectionId: string,
  kind: SyncKind,
  now: Date,
): Promise<void> {
  const run = await recordRun(ctx, { connectionId, kind });
  await skipRun(ctx, run.id, REVOKED_REASON, now);
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The first step of a pass (rewrite plan N3.1; 12-account-modes.md §12.8, point 10): the manual
 * movements that wait are written to the source before anything is read, so the balances and the
 * movements read next already hold them. A failure of the connection is handed back, not thrown:
 * the readings are still attempted, and the pass of the movements fails with it.
 */
async function sendPending(input: PassInput): Promise<SendOutcome> {
  const { ctx, source } = input;
  const provider = input.connection.provider;
  const sink = movementsSink();
  const accounts = await linkedAccounts(ctx, provider);
  const externalIdOf = new Map([...accounts].map(([externalId, account]) => [account.id, externalId]));
  const waiting = await sink.pendingSends(ctx, [...externalIdOf.keys()]);
  if (waiting.length === 0) return { counts: { sent: 0, notSent: 0 }, failure: undefined };
  return sendManualMovements(
    source,
    waiting.map((movement) => ({
      ...movement,
      accountExternalId: externalIdOf.get(movement.accountId) ?? "",
    })),
    {
      categoryFor: (categoryId) => sink.sourceCategoryFor(ctx, provider, categoryId),
      markNotSent: (id, askedOn) => sink.markNotSent(ctx, id, askedOn),
      settle: (id, sent) => sink.settleSent(ctx, id, { provider, ...sent }),
    },
  );
}

/**
 * The movements that waited, sent before any reading. A connection with no schedule is paused: it
 * sends nothing, and the movements go when it is resumed (ux/n3-categories-manual.md §9.8).
 */
async function sendBeforeReading(input: PassInput): Promise<SendOutcome> {
  const nothing: SendOutcome = { counts: { sent: 0, notSent: 0 }, failure: undefined };
  if (input.connection.schedule.rules.length === 0) return nothing;
  // Only a source that takes the movements written here (`createRecord`) is sent any.
  if (!(await providerCan(input.connection.provider, "createRecord"))) return nothing;
  try {
    return await sendPending(input);
  } catch (error) {
    return { ...nothing, failure: error };
  }
}

/** What a pass carries from one kind to the next. */
interface Carried {
  /** What the accounts pass proved present: whose window the movements pass may judge. */
  covered: ReadonlySet<string> | undefined;
  sending: SendOutcome;
  categoryWriter: SourceCategoryWriter | null;
}

/** One kind of the pass: its counts, and the failure of the sending it fails with. */
async function passKind(input: PassInput, kind: SyncKind, carried: Carried) {
  if (kind === "accounts") {
    const pass = await syncAccounts(input);
    carried.covered = pass.present;
    return { counts: pass.counts, sendFailure: undefined };
  }
  const counts = await syncTransactions({
    ...input,
    covered: carried.covered,
    categoryWriter: carried.categoryWriter,
  });
  if (carried.sending.counts.sent > 0) counts[SENT] = carried.sending.counts.sent;
  if (carried.sending.counts.notSent > 0) counts[NOT_SENT] = carried.sending.counts.notSent;
  return { counts, sendFailure: carried.sending.failure };
}

/**
 * One kind, in its own run. Returns the failure it ended with, if any: a refused token marks the
 * connection `revoked`, and the kinds after it are skipped by the caller.
 */
async function runKind(
  input: PassInput,
  kind: SyncKind,
  carried: Carried,
  result: SourceSyncResult,
): Promise<{ failure?: unknown; refused: boolean }> {
  const { ctx, connection, now } = input;
  const run = await recordRun(ctx, { connectionId: connection.id, kind });
  try {
    const { counts, sendFailure } = await passKind(input, kind, carried);
    if (kind === "accounts" || kind === "transactions") result[kind] = counts;
    // A connection that failed while sending fails the pass of the movements, with what it read.
    if (sendFailure === undefined) await finishRun(ctx, run.id, { counts }, now);
    else await finishRun(ctx, run.id, { counts, error: describeError(sendFailure), cause: sendFailure }, now);
    // The movements are in: the month ends of the synced accounts are rebuilt from them (spec
    // §7.1, F2.5). After the reads, with nothing held open; a failure here fails the pass like
    // any other, because a chart standing on stale rebuilt ends is a wrong answer.
    if (kind === "transactions") await movementsSink().rebuildDerivedBalances(ctx);
    return { failure: sendFailure, refused: false };
  } catch (error) {
    const message = describeError(error);
    // A refused verdict still imported everything it read: the run says so, and says why.
    const counts = error instanceof RemovalRefusedError ? error.counts : {};
    await finishRun(ctx, run.id, { counts, error: message, cause: error }, now);
    const refused = isTokenRefused(error);
    if (refused) await markConnection(ctx, connection.id, "revoked", message, now);
    return { failure: error, refused };
  }
}

/** The writer of the categories, for a source that takes them (`categories`); `null` otherwise. */
async function writerOf(provider: string, source: SourceCalls): Promise<SourceCategoryWriter | null> {
  return (await providerCan(provider, "categories")) ? categoryWriterOf(source) : null;
}

/** One pass, with the lock already held. */
async function sourcePass(
  ctx: Ctx,
  connectionId: string,
  options: SourceSyncOptions,
): Promise<SourceSyncResult> {
  const now = options.now ?? new Date();
  const connection = await sourceConnection(ctx, connectionId);
  const result: SourceSyncResult = { accounts: {}, transactions: {}, refused: null };

  if (connection.state === "revoked") {
    for (const kind of PLUGIN_KINDS) await skipKind(ctx, connectionId, kind, now);
    return { ...result, refused: "revoked" };
  }

  const source = options.source ?? (await connectionSource(ctx, connection));
  const input: PassInput = { ctx, connection, source, now };
  const categoryWriter =
    options.categoryWriter !== undefined
      ? options.categoryWriter
      : await writerOf(connection.provider, source);
  const carried: Carried = { covered: undefined, sending: await sendBeforeReading(input), categoryWriter };
  let refused = false;
  let failure: unknown;
  // The accounts first, so the movements pass knows which accounts were proven present.
  for (const kind of PLUGIN_KINDS) {
    if (refused) {
      await skipKind(ctx, connectionId, kind, now);
      continue;
    }
    const outcome = await runKind(input, kind, carried, result);
    refused = outcome.refused;
    failure ??= outcome.failure;
  }

  if (failure !== undefined) throw failure;
  return result;
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
 * error (a `PluginCallError`, whose code is how Settings › Integrations tells "token rejected" from
 * "unreachable") while the log already holds the whole pass.
 *
 * The whole pass runs under one advisory lock per connection, so "Sync now" and the hourly job can
 * never overlap on it: the lock is here and not in the caller because both callers go through this
 * function, and two concurrent passes write two `transactions` rows for one movement of the source
 * (`linkExternal` upserts on the external key and rewrites `entity_id`, so the second pass succeeds
 * and the first row is orphaned, then labelled gone from the provider for ever). A caller that does
 * not get the lock gets {@link SyncBusyError} and no `sync_runs` row.
 */
export async function syncSourceNow(
  ctx: Ctx,
  connectionId: string,
  options: SourceSyncOptions = {},
): Promise<SourceSyncResult> {
  const outcome = await withJobLock(`${SYNC_LOCK_PREFIX}${connectionId}`, () =>
    sourcePass(ctx, connectionId, options),
  );
  if (!outcome.ran) throw new SyncBusyError();
  return outcome.value;
}
