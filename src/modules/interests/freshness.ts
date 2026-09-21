/**
 * The balance a rule is about to accrue on has to be a *fresh* one (spec §7.6).
 *
 * A synced account's day balances are not stored day by day: they are reconstructed from its
 * latest provider reading walked through its movements (`dailySeries`, mode `movements`, in the
 * accounts module). So a reading that did not land this hour does not make one day wrong — it
 * moves the whole window, and the interest of every day of it with it. Accruing then produces a
 * plausible, wrong number, in silence, and settles it, and publishes it.
 *
 * This file is what the accrual job calls first: for every synced account its rules touch, it runs
 * one Wallet pass on the connection — one per connection per job pass, through `syncWalletNow`,
 * which holds the advisory lock the hourly sync and "Sync now" already share — waits for it, and
 * then reports, per account, whether the reading in hand is recent enough to accrue on. A manual
 * account has nothing to synchronise and is always ready.
 *
 * It decides nothing else: the job skips the rules whose accounts came back stale, and says so.
 * Nothing here writes to the interest tables, and nothing here accrues.
 */
import "server-only";
import { redactForLog } from "@/platform/auth/logger";
import { type Account, listAccounts } from "@/modules/accounts/queries";
import type { Ctx } from "@/platform/context";
import { WALLET_PROVIDER } from "@/platform/integrations/rules";
import { listConnections } from "@/platform/integrations/service";
import { isSyncBusy, syncWalletNow, type WalletSyncResult } from "@/platform/integrations/wallet/sync";
import { FRESH_READING_MS, isFreshReading } from "./rules";

/**
 * Why an account's balance is not one to accrue on. Each is a fact about this pass, not a verdict
 * on the account: the next pass asks again.
 *
 * - `no_connection` — the account says it is synced and no Wallet connection can refresh it;
 * - `revoked` — the token is refused, so the pass attempted nothing at all;
 * - `sync_failed` — the pass ran and failed (unreachable, truncated window, refused removal…);
 * - `sync_busy` — another pass held the connection's lock and had not landed a reading in time;
 * - `not_read` — the pass succeeded but brought no reading for *this* account (Wallet no longer
 *   returns it, or it is not linked), which is exactly the case a shared "the sync went fine"
 *   would hide.
 */
export type StaleReason = "no_connection" | "revoked" | "sync_failed" | "sync_busy" | "not_read";

/** What one account's balance is worth to an accrual about to start. */
export interface BalanceReading {
  /** `manual`: nothing to synchronise. `fresh`: accrue. `stale`: do not accrue. */
  state: "manual" | "fresh" | "stale";
  reason: StaleReason | null;
  lastSyncedAt: Date | null;
}

export interface FreshnessOptions {
  now?: Date;
  /** Injected in tests, so no Wallet is ever called: one pass on one connection. */
  sync?: (connectionId: string) => Promise<WalletSyncResult>;
  /** Injected in tests so the wait for a concurrent pass is not actually waited through. */
  sleep?: (ms: number) => Promise<void>;
  /** How old a reading may be; {@link FRESH_READING_MS} by default. */
  maxAgeMs?: number;
  /** How long to wait for a pass that already held the lock. */
  busyWaitMs?: number;
  busyPollMs?: number;
}

/**
 * How long a pass that lost the lock waits for the one that holds it, and how often it looks.
 *
 * Waiting is the whole point of the lock here: the other pass is reading exactly what this one
 * would have read, so the reading it is about to write is the reading we want. A second
 * `syncWalletNow` would be a second pass on the same connection in the same tick, which is what
 * the lock exists to prevent — so this watches `last_synced_at` instead of calling again.
 */
const BUSY_WAIT_MS = 60_000;
const BUSY_POLL_MS = 2_000;

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/** An account is synced when it says so *and* carries the provider's id of it (spec §7.1). */
function isSynced(account: Account): boolean {
  return account.origin === "synced" && account.providerAccountId !== null;
}

async function accountsById(ctx: Pick<Ctx, "userId">, wanted: ReadonlySet<string>) {
  const rows = await listAccounts(ctx, { includeArchived: true });
  return new Map(rows.filter((account) => wanted.has(account.id)).map((account) => [account.id, account]));
}

/**
 * Makes sure every synced account among `accountIds` has a reading no older than `maxAgeMs`, and
 * says for each one whether it has.
 *
 * The order is: look at what is in hand, run **one** pass per Wallet connection, look again. The
 * second look is what decides — a pass that answered "fine" while bringing nothing for an account
 * leaves it stale, and a pass that failed leaves fresh whatever another pass had just brought.
 *
 * Never throws for a provider's sake: a failed, refused or busy pass is an answer (`stale` with
 * its reason), because the caller's job is to skip a rule, not to fail a run for everybody.
 */
export async function ensureFreshBalances(
  ctx: Ctx,
  accountIds: readonly string[],
  options: FreshnessOptions = {},
): Promise<Map<string, BalanceReading>> {
  const now = options.now ?? new Date();
  const maxAgeMs = options.maxAgeMs ?? FRESH_READING_MS;
  const sleep = options.sleep ?? defaultSleep;
  const runSync = options.sync ?? ((connectionId: string) => syncWalletNow(ctx, connectionId, { now }));
  const wanted = new Set(accountIds);
  const readings = new Map<string, BalanceReading>();
  if (wanted.size === 0) return readings;

  const before = await accountsById(ctx, wanted);
  const synced = [...before.values()].filter(isSynced);
  for (const id of wanted) {
    const account = before.get(id);
    // An account that is not one of this user's open or archived accounts is not this file's
    // problem: the accrual will fail on it, loudly, by itself.
    if (!account || !isSynced(account)) {
      readings.set(id, { state: "manual", reason: null, lastSyncedAt: account?.lastSyncedAt ?? null });
    }
  }
  if (synced.length === 0) return readings;

  const connections = (await listConnections(ctx)).filter(
    (connection) => connection.provider === WALLET_PROVIDER,
  );
  // One reason for the whole connection set: every synced account of this user hangs off it, and
  // the second look is what tells them apart anyway.
  let reason: StaleReason | null = connections.length === 0 ? "no_connection" : null;
  let busy = false;

  for (const connection of connections) {
    if (connection.state === "revoked") {
      reason ??= "revoked";
      continue;
    }
    try {
      const result = await runSync(connection.id);
      if (result.refused === "revoked") reason ??= "revoked";
    } catch (error) {
      if (isSyncBusy(error)) {
        busy = true;
        continue;
      }
      // Logged here and not re-thrown: Settings › Integrations already has the failure in
      // `sync_runs`; what this pass owes the caller is the verdict, not the exception.
      console.error("[interests] the Wallet pass before accrual failed", redactForLog(error));
      reason ??= "sync_failed";
    }
  }

  let after = await accountsById(ctx, wanted);
  if (busy) {
    // A pass was already running: wait for *its* reading rather than starting a second one.
    const deadline = Date.now() + (options.busyWaitMs ?? BUSY_WAIT_MS);
    while (
      synced.some((account) => !isFreshReading(after.get(account.id)?.lastSyncedAt ?? null, now, maxAgeMs))
    ) {
      if (Date.now() >= deadline) {
        reason ??= "sync_busy";
        break;
      }
      await sleep(options.busyPollMs ?? BUSY_POLL_MS);
      after = await accountsById(ctx, wanted);
    }
  }

  for (const account of synced) {
    const lastSyncedAt = after.get(account.id)?.lastSyncedAt ?? null;
    readings.set(
      account.id,
      isFreshReading(lastSyncedAt, now, maxAgeMs)
        ? { state: "fresh", reason: null, lastSyncedAt }
        : { state: "stale", reason: reason ?? "not_read", lastSyncedAt },
    );
  }
  return readings;
}
