/**
 * The accounts of a source (spec §9.1, §7.1): the pass of the accounts and their balances, and the
 * choice of which of the source's accounts arrive here (PERS-419).
 */
import type { Ctx } from "@ledgerly/domain/platform/context";
import {
  type Connection,
  IntegrationError,
  listConnections,
  readSyncJob,
  saveIbanConflicts,
  saveSkippedAccounts,
  skippedAccounts,
} from "@ledgerly/domain/platform/integrations";
import { today } from "@ledgerly/domain/shared/dates";
import { parseCents } from "@ledgerly/domain/shared/money";
import { providerCan } from "../capabilities";
import { type SourceCalls, connectionSource } from "./calls";
import { backfillDepth } from "./depth";
import { requestSourceBackfill } from "./cursor";
import { toRemoteAccount } from "./incoming";
import { movementsSink } from "./ports";

/**
 * The keys the run catalogue translates. Anything a pass wants to say has to be said in these
 * four, so the history reads the same for every kind and every provider.
 */
export const CREATED = "created";
export const UPDATED = "updated";
export const SKIPPED = "skipped";
export const REMOVED = "removed";

/** A connection of the person whose plugin is a source read with a token (`source.read`). */
export async function sourceConnection(ctx: Pick<Ctx, "userId">, connectionId: string): Promise<Connection> {
  const connection = (await listConnections(ctx)).find((one) => one.id === connectionId);
  if (!connection) throw new IntegrationError("not_found");
  if (!(await providerCan(connection.provider, "source.read")))
    throw new IntegrationError("unknown_provider");
  return connection;
}

/** The local accounts this provider owns, by the provider's own id. Archived ones included: they
 * are still the provider's accounts, and leaving them out would create a second row for each. */
export async function linkedAccounts(
  ctx: Pick<Ctx, "userId">,
  provider: string,
): Promise<Map<string, { id: string; name: string }>> {
  const rows = await movementsSink().listAccounts(ctx, { includeArchived: true });
  const byExternalId = new Map<string, { id: string; name: string }>();
  for (const account of rows) {
    if (account.provider !== provider || account.providerAccountId === null) continue;
    byExternalId.set(account.providerAccountId, { id: account.id, name: account.name });
  }
  return byExternalId;
}

/** What the accounts pass leaves behind: its counts, and the provider ids its answer carried. */
interface AccountsPass {
  counts: Record<string, number>;
  present: ReadonlySet<string>;
}

/** One pass over one connection: who, which connection, through which calls, and when. */
export interface PassInput {
  ctx: Pick<Ctx, "userId" | "timeZone">;
  connection: Connection;
  source: SourceCalls;
  now: Date;
}

/** The balances the answer carried, written with the civil date of this reading in the user's zone. */
async function writeBalances(
  input: PassInput,
  remote: readonly { externalId: string; balance: string | null; available: string | null }[],
  after: ReadonlyMap<string, { id: string }>,
): Promise<{ written: number; skipped: number }> {
  const { ctx, now } = input;
  const day = today(ctx.timeZone, now);
  let written = 0;
  let skipped = 0;
  for (const account of remote) {
    if (account.balance === null) continue;
    const accountId = after.get(account.externalId)?.id;
    if (accountId === undefined) {
      skipped += 1;
      continue;
    }
    const availableCents = account.available === null ? null : parseCents(account.available);
    const saved = await movementsSink().saveProviderBalance(
      ctx,
      accountId,
      { on: day, cents: parseCents(account.balance), availableCents },
      now,
    );
    // `null`: a service of Investments owns the account's balance (§1.3), not this pass.
    if (saved === null) skipped += 1;
    else written += 1;
  }
  return { written, skipped };
}

/**
 * Accounts and balances (spec §9.1: both, every hour).
 *
 * One read gives both — the source publishes the balance inside the account — and it happens before
 * anything is written. `applyProviderAccounts` then decides the
 * lifecycle of §7.1 (adopt once, follow a rename, keep an archived account archived, mark a
 * vanished one `unavailable`), and each balance is stamped with the civil date of *this reading in
 * the user's own zone*, which is the one thing the client cannot know.
 *
 * An archived account of the source is still an account the provider returned, so it counts as
 * present: "gone from the provider" is reserved for an account that stopped being returned at all.
 *
 * The pass also reports **which** of the provider's accounts this answer carried, because it is the
 * only place that knows: the movements pass needs it to decide whose window it is entitled to judge
 * (spec §7.1 — a vanished account is never deleted, and hiding its movements would delete it).
 */
export async function syncAccounts(input: PassInput): Promise<AccountsPass> {
  const { ctx, connection, source, now } = input;
  const provider = connection.provider;
  const remote = await source.accounts();

  const before = await linkedAccounts(ctx, provider);
  // An account the person left out, or deleted, is neither made nor updated here (PERS-419). One
  // already here is never left out: the choice offers only the accounts Ledgerly does not have.
  const leftOut = await skippedAccounts(ctx, connection.id);
  const chosen = remote.filter(
    (account) => before.has(account.externalId) || !leftOut.has(account.externalId),
  );
  const applied = await movementsSink().applyProviderAccounts(
    ctx,
    provider,
    chosen.map((account) => toRemoteAccount(account, provider)),
    now,
  );
  await saveIbanConflicts(ctx, connection.id, applied.ibanConflicts);
  const after = await linkedAccounts(ctx, provider);
  const { written, skipped } = await writeBalances(input, remote, after);

  const present = new Set(remote.map((account) => account.externalId));
  const gone = [...before.keys()].filter((externalId) => !present.has(externalId));
  return {
    counts: {
      [CREATED]: [...after.keys()].filter((externalId) => !before.has(externalId)).length,
      [UPDATED]: written,
      [SKIPPED]: skipped,
      [REMOVED]: gone.length,
    },
    present,
  };
}

/* The choice of the accounts (PERS-419) */

/** One account of the source on the choice of Settings › Integrations. */
interface SourceAccountChoice {
  externalId: string;
  name: string;
  /** The account here it arrives in; `null` when Ledgerly does not have it. */
  local: { id: string; name: string } | null;
  /** It arrives here: already here, or not left out. */
  chosen: boolean;
}

/**
 * The accounts the source has now, as the choice shows them: the ones here (always chosen, removed
 * only by deleting the account), and the others, chosen unless the person left them out. Read from
 * the source when the choice opens, never stored: no name of a source waits in a column.
 */
export async function sourceAccountChoices(
  ctx: Pick<Ctx, "userId">,
  connectionId: string,
  options: { source?: SourceCalls } = {},
): Promise<SourceAccountChoice[]> {
  const connection = await sourceConnection(ctx, connectionId);
  const source = options.source ?? (await connectionSource(ctx, connection));
  const remote = await source.accounts();
  const here = await linkedAccounts(ctx, connection.provider);
  const skipped = await skippedAccounts(ctx, connectionId);
  return remote
    .map((account) => {
      const local = here.get(account.externalId) ?? null;
      return {
        externalId: account.externalId,
        name: account.name,
        local,
        chosen: local !== null || !skipped.has(account.externalId),
      };
    })
    .sort(
      (left, right) => left.name.localeCompare(right.name) || left.externalId.localeCompare(right.externalId),
    );
}

/**
 * Saves which of the source's accounts not here arrive here: `chosen` are the source's ids to
 * bring, every other one is left out. An account already here is not touched — it leaves only by
 * being deleted. When an account comes back, the next pass downloads the history again, as deep as
 * the last download, so its movements come back too; what is already here is recognised by its id.
 * Returns how many accounts come back; the pass is the caller's next call.
 */
export async function chooseSourceAccounts(
  ctx: Pick<Ctx, "userId">,
  connectionId: string,
  chosen: readonly string[],
  options: { source?: SourceCalls } = {},
): Promise<{ added: number }> {
  const choices = await sourceAccountChoices(ctx, connectionId, options);
  const wanted = new Set(chosen);
  const skipped = await skippedAccounts(ctx, connectionId);
  let added = 0;
  for (const choice of choices) {
    if (choice.local !== null) continue;
    if (!wanted.has(choice.externalId)) skipped.add(choice.externalId);
    else if (skipped.delete(choice.externalId)) added += 1;
  }
  await saveSkippedAccounts(ctx, connectionId, skipped);
  if (added > 0) {
    const job = await readSyncJob(ctx, connectionId, "transactions");
    await requestSourceBackfill(ctx, connectionId, backfillDepth(job?.cursor));
  }
  return { added };
}
