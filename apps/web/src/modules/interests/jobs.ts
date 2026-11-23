import "server-only";
import { and, asc, eq } from "drizzle-orm";
import { forEachUser } from "@ledgerly/domain/users";
import type { Ctx } from "@ledgerly/domain/platform/context";
import { getDb } from "@ledgerly/domain/platform/db";
import { userScoped } from "@ledgerly/domain/platform/db";
import { runAfterSync } from "@/platform/jobs/after-sync";
import type { JobDefinition } from "@/platform/jobs/registry";
import type { JobDetail } from "@ledgerly/domain/platform/jobs";
import { interestRules } from "@ledgerly/domain/interests";
import { type Account, isStale, listAccounts } from "@ledgerly/domain/accounts";
import { ACCRUAL_READING_MAX_AGE_HOURS } from "@ledgerly/domain/interests";
import { redactForLog } from "@ledgerly/domain/platform/auth";
import { connectionsThatCan, isSyncBusy, syncSourceNow } from "@ledgerly/plugin-host";
import { runsAt } from "@ledgerly/domain/interests";
import { bringUpToDate } from "@ledgerly/domain/interests";

// ——— Sync, then accrue (audit INT-2) ———————————————————————————————————————————————————————————
/*
 * The balance a rule is about to accrue on has to be a *fresh* one (spec §7.6).
 *
 * A synced account's day balances are not stored day by day: they are reconstructed from its
 * latest provider reading walked through its movements (`dailySeries`, mode `movements`, in the
 * accounts module). So a reading that did not land this hour does not make one day wrong — it
 * moves the whole window, and the interest of every day of it with it. Accruing then produces a
 * plausible, wrong number, in silence, and settles it, and publishes it.
 *
 * This part of the job runs first: for every synced account its rules touch, it runs
 * one pass of the source on the connection — one per connection per job pass, through `syncSourceNow`,
 * which holds the advisory lock the hourly sync and "Sync now" already share — waits for it, and
 * then reports, per account, whether the reading in hand is recent enough to accrue on. A manual
 * account has nothing to synchronise and is always ready.
 *
 * It decides nothing else: the job skips the rules whose accounts came back stale, and says so.
 * Nothing here writes to the interest tables, and nothing here accrues.
 */

type SourceSyncResult = Awaited<ReturnType<typeof syncSourceNow>>;

/**
 * Why an account's balance is not one to accrue on. Each is a fact about this pass, not a verdict
 * on the account: the next pass asks again.
 *
 * - `no_connection` — the account says it is synced and no connection to a source can refresh it;
 * - `revoked` — the token is refused, so the pass attempted nothing at all;
 * - `sync_failed` — the pass ran and failed (unreachable, truncated window, refused removal…);
 * - `sync_busy` — another pass held the connection's lock and had not landed a reading in time;
 * - `not_read` — the pass succeeded but brought no reading for *this* account (the source no longer
 *   returns it, or it is not linked), which is exactly the case a shared "the sync went fine"
 *   would hide.
 */
type StaleReason = "no_connection" | "revoked" | "sync_failed" | "sync_busy" | "not_read";

/** What one account's balance is worth to an accrual about to start. */
interface BalanceReading {
  /** `manual`: nothing to synchronise. `fresh`: accrue. `stale`: do not accrue. */
  state: "manual" | "fresh" | "stale";
  reason: StaleReason | null;
  lastSyncedAt: Date | null;
}

interface FreshnessOptions {
  now?: Date;
  /** Injected in tests, so no source is ever called: one pass on one connection. */
  sync?: (connectionId: string) => Promise<SourceSyncResult>;
  /** Injected in tests so the wait for a concurrent pass is not actually waited through. */
  sleep?: (ms: number) => Promise<void>;
  /** How long to wait for a pass that already held the lock. */
  busyWaitMs?: number;
  busyPollMs?: number;
}

/**
 * How long a pass that lost the lock waits for the one that holds it, and how often it looks.
 *
 * Waiting is the whole point of the lock here: the other pass is reading exactly what this one
 * would have read, so the reading it is about to write is the reading we want. A second
 * `syncSourceNow` would be a second pass on the same connection in the same tick, which is what
 * the lock exists to prevent — so this watches `last_synced_at` instead of calling again.
 */
const BUSY_WAIT_MS = 60_000;
const BUSY_POLL_MS = 2_000;

const defaultSleep = (delay: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, delay);
  });

/** An account is synced when it says so *and* carries the provider's id of it (spec §7.1). */
function isSynced(account: Account): boolean {
  return account.origin === "synced" && account.providerAccountId !== null;
}

async function accountsById(ctx: Pick<Ctx, "userId">, wanted: ReadonlySet<string>) {
  const rows = await listAccounts(ctx, { includeArchived: true });
  return new Map(rows.filter((account) => wanted.has(account.id)).map((account) => [account.id, account]));
}

/** What one round of passes on the person's connections to a source leaves: a reason, and a pass already running. */
async function syncConnections(
  ctx: Ctx,
  runSync: (connectionId: string) => Promise<SourceSyncResult>,
): Promise<{ reason: StaleReason | null; busy: boolean }> {
  const connections = await connectionsThatCan(ctx, "source.read");
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
      console.error("[interests] the pass of the source before accrual failed", redactForLog(error));
      reason ??= "sync_failed";
    }
  }
  return { reason, busy };
}

/**
 * A pass was already running: wait for *its* reading rather than starting a second one. Returns the
 * accounts as they stand at the end, and whether the wait ran out.
 */
async function waitForReadings(
  ctx: Ctx,
  synced: readonly Account[],
  wanted: ReadonlySet<string>,
  wait: { now: Date; sleep: (ms: number) => Promise<void>; waitMs: number; pollMs: number },
): Promise<{ after: Map<string, Account>; timedOut: boolean }> {
  let after = await accountsById(ctx, wanted);
  const deadline = Date.now() + wait.waitMs;
  const fresh = () =>
    synced.every(
      (account) =>
        !isStale(after.get(account.id)?.lastSyncedAt ?? null, ACCRUAL_READING_MAX_AGE_HOURS, wait.now),
    );
  while (!fresh()) {
    if (Date.now() >= deadline) return { after, timedOut: true };
    await wait.sleep(wait.pollMs);
    after = await accountsById(ctx, wanted);
  }
  return { after, timedOut: false };
}

/**
 * Makes sure every synced account among `accountIds` has a reading no older than {@link ACCRUAL_READING_MAX_AGE_HOURS}, and
 * says for each one whether it has.
 *
 * The order is: look at what is in hand, run **one** pass per connection to a source, look again. The
 * second look is what decides — a pass that answered "fine" while bringing nothing for an account
 * leaves it stale, and a pass that failed leaves fresh whatever another pass had just brought.
 *
 * Never throws for a provider's sake: a failed, refused or busy pass is an answer (`stale` with
 * its reason), because the caller's job is to skip a rule, not to fail a run for everybody.
 */
async function ensureFreshBalances(
  ctx: Ctx,
  accountIds: readonly string[],
  options: FreshnessOptions = {},
): Promise<Map<string, BalanceReading>> {
  const wait = waitOf(options);
  const wanted = new Set(accountIds);
  if (wanted.size === 0) return new Map();
  const before = await accountsById(ctx, wanted);
  const readings = manualReadings(wanted, before);
  const synced = [...before.values()].filter(isSynced);
  if (synced.length === 0) return readings;

  const runSync =
    options.sync ?? ((connectionId: string) => syncSourceNow(ctx, connectionId, { now: wait.now }));
  const passes = await syncConnections(ctx, runSync);
  const waited = passes.busy
    ? await waitForReadings(ctx, synced, wanted, wait)
    : { after: await accountsById(ctx, wanted), timedOut: false };
  const reason = passes.reason ?? (waited.timedOut ? "sync_busy" : "not_read");
  for (const account of synced) {
    const lastSyncedAt = waited.after.get(account.id)?.lastSyncedAt ?? null;
    readings.set(
      account.id,
      !isStale(lastSyncedAt, ACCRUAL_READING_MAX_AGE_HOURS, wait.now)
        ? { state: "fresh", reason: null, lastSyncedAt }
        : { state: "stale", reason, lastSyncedAt },
    );
  }
  return readings;
}

/** The options of a run with their defaults. */
function waitOf(options: FreshnessOptions) {
  return {
    now: options.now ?? new Date(),
    sleep: options.sleep ?? defaultSleep,
    waitMs: options.busyWaitMs ?? BUSY_WAIT_MS,
    pollMs: options.busyPollMs ?? BUSY_POLL_MS,
  };
}

/**
 * The accounts with nothing to synchronise. An account that is not one of this user's open or
 * archived accounts is not this file's problem: the accrual will fail on it, loudly, by itself.
 */
function manualReadings(wanted: ReadonlySet<string>, before: ReadonlyMap<string, Account>) {
  const readings = new Map<string, BalanceReading>();
  for (const id of wanted) {
    const account = before.get(id);
    if (!account || !isSynced(account)) {
      readings.set(id, { state: "manual", reason: null, lastSyncedAt: account?.lastSyncedAt ?? null });
    }
  }
  return readings;
}

/**
 * Every hour (spec §10.2, tier `hourly`), each rule accrued once a day at **its own** hour: a pass
 * takes only the active rules whose hour — `run_hour`, or noon when it has none — is the hour the
 * clock shows *in the owner's zone*, never the server's. A rule with no hour set therefore still
 * accrues once a day at 12:00 local, exactly as the daily job did.
 *
 * What it does for a rule is unchanged: accrued up to yesterday — the day whose balance is closed
 * — and the periods that have ended settled, a missed day caught up on the next pass, in order.
 * One row per rule and day, so a second pass in the same hour (or the same day) writes nothing
 * twice. Nothing is published on the source any more (decision H37, release R5c).
 *
 * The hourly tick is Europe/Rome (`SCHEDULE` of the jobs registry): the hour a zone skips when it springs forward has
 * no pass of its own, and the hour it repeats when it falls back has two — harmless, being
 * idempotent.
 *
 * **Before a rule accrues, its balance is made fresh** (spec §7.6): the connection to a source of every
 * synced account the due rules touch is synchronised once — `ensureFreshBalances`, one pass per
 * connection per tick, through the lock `syncSourceNow` already holds — and the pass is waited
 * for. A rule whose account came back with a reading too old to trust is **not** accrued: it is
 * counted in `stale` with the reason, and the rule's own page says the accrual is on hold, rather
 * than a wrong number being produced, settled and published in silence. A manual account has
 * nothing to synchronise and accrues as it always did.
 */
/** What one user's pass did, so the job can add the users up and a test can drive one of them. */
interface AccrualPass {
  /** Rules brought up to date. */
  rules: number;
  /** Rules left alone because their balance was not one to accrue on. */
  stale: number;
  reasons: StaleReason[];
}

/** The active rules of one user whose hour is now in their own zone. */
async function dueRules(ctx: Pick<Ctx, "userId" | "timeZone">, now: Date) {
  const active = await getDb()
    .select({
      id: interestRules.id,
      accountId: interestRules.accountId,
      runHour: interestRules.runHour,
    })
    .from(interestRules)
    .where(and(userScoped(ctx).owns(interestRules), eq(interestRules.state, "active")))
    .orderBy(asc(interestRules.id));
  return active.filter((rule) => runsAt(rule.runHour, now, ctx.timeZone));
}

/**
 * One user's due rules, accrued on a balance that has just been made fresh (spec §7.6).
 *
 * Exported so an integration test can drive a pass with a fake source (`options.sync`) instead of
 * the real one: the job itself takes no arguments, and a seam is cheaper than a job that reads a
 * global to know whether it is being tested.
 */
export async function accrueDueRules(
  ctx: Ctx,
  now: Date,
  options: FreshnessOptions = {},
): Promise<AccrualPass> {
  const pass: AccrualPass = { rules: 0, stale: 0, reasons: [] };
  const due = await dueRules(ctx, now);
  if (due.length === 0) return pass;

  // One pass of the source per connection, however many rules of this user are due on it.
  const readings = await ensureFreshBalances(
    ctx,
    due.map((rule) => rule.accountId),
    { now, ...options },
  );
  for (const rule of due) {
    const reading = readings.get(rule.accountId);
    if (reading?.state === "stale") {
      // Skipped, never accrued on a balance nobody stands behind: the days stay unaccrued and the
      // next pass, with a reading in hand, catches them up in order.
      pass.stale += 1;
      if (reading.reason && !pass.reasons.includes(reading.reason)) pass.reasons.push(reading.reason);
      continue;
    }
    await bringUpToDate(ctx, rule.id, now);
    pass.rules += 1;
  }
  return pass;
}

export const interestsAccrualJob: JobDefinition = {
  name: "interests-accrual",
  tier: "hourly",
  // An hour with no rule due leaves no row: 23 hours out of 24 for a rule at its one hour.
  async hasWork() {
    const now = new Date();
    let any = false;
    await forEachUser(
      "interests-accrual",
      async (_person, ctx) => {
        if (!any) any = (await dueRules(ctx, now)).length > 0;
      },
      { addon: "interests" },
    );
    return any;
  },
  async run(): Promise<JobDetail> {
    const now = new Date();
    let rules = 0;
    let stale = 0;
    const reasons = new Set<StaleReason>();
    const counts = await forEachUser(
      "interests-accrual",
      async (_person, ctx) => {
        const pass = await accrueDueRules(ctx, now);
        rules += pass.rules;
        stale += pass.stale;
        for (const reason of pass.reasons) reasons.add(reason);
      },
      { addon: "interests" },
    );
    // The pass of the source before the accrual is a sync too: what it brought in gets the same checks.
    await runAfterSync("hourly");
    return {
      ...counts,
      rules,
      stale,
      // Why the skipped ones were skipped, once each: the run's own account of a pass that found
      // nothing fresh to accrue on, without a row per rule in a job detail.
      staleReasons: reasons.size === 0 ? null : [...reasons].sort().join(", "),
    };
  },
};
