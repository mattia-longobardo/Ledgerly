/**
 * Monthly close — the accounts module's replacement for the old monthly
 * snapshot job. Where the retired job read Wallet at 23:59 and patched a
 * spreadsheet row, this one reads whatever balance each account already has
 * on file and freezes the previous month's figure as an `account_balances`
 * row of its own, `source: "system"`.
 *
 * It is deliberately passive: it invents nothing and calls no upstream. A
 * manual account with no entry that month simply has no closing row, and an
 * account nobody has ever recorded a balance for is skipped outright — never
 * a zero standing in for "unknown".
 */

import { and, asc, eq } from "drizzle-orm";
import { alertJobFailure } from "@/lib/clients/gotify";
import { errorMessage } from "@/lib/clients/http";
import type { JobResult } from "@/lib/contracts";
import { db } from "@/lib/db";
import { userRoles, users } from "@/lib/db/schema";
import { addMonths, monthKey } from "@/lib/time";
import { finishRun, startRun, withJobLock } from "@/lib/repo/jobs";
import type { AccountsRepository, Clock, NewBalance } from "@/modules/accounts/application/ports";
import { DrizzleAccountsRepository } from "@/modules/accounts/infrastructure/drizzle-accounts-repository";
import { lastDayOfMonth } from "@/modules/accounts/infrastructure/teable-import";
import { withUserContext } from "@/platform/db/context";

export const JOB_NAME = "monthly_close" as const;

/** One instance at a time: the crontab entry uses `curl --retry`. */
export const LOCK_KEY = JOB_NAME;

export interface RunMonthlyCloseInput {
  trigger: "cron" | "manual";
  now: Date;
}

/**
 * Freezes the previous Rome month's balance for every non-archived account:
 * the latest point on file with `asOf` at or before the close day, written
 * again with `asOf` pinned to the close day itself and `source: "system"`.
 *
 * "Latest on file" is any source — manual, provider, a prior close, even a
 * migrated row — because by the time a month is closing, whatever value is
 * newest IS the account's balance for that month; there is no "authoritative"
 * source to prefer over another the way the old snapshot job had to prefer
 * Wallet over a hand-typed figure. An account with no point at or before the
 * close day is skipped, not zeroed: a balance nobody has ever recorded is
 * unknown, not empty.
 *
 * Idempotent through `recordBalances`' upsert on `(accountId, asOf, source)`:
 * a second run over the same data finds the very row this call just wrote
 * (it is itself dated on-or-before the close day) and rewrites the same
 * balance, so nothing actually changes.
 */
export async function closePreviousMonth(
  deps: { accounts: AccountsRepository; clock: Clock },
  userId: string,
): Promise<{ closed: number }> {
  const now = deps.clock.now();
  const closeMonth = addMonths(monthKey(now), -1);
  const closeDay = lastDayOfMonth(closeMonth);

  const accounts = await deps.accounts.list(userId);
  const history = await deps.accounts.history(
    userId,
    accounts.map((a) => a.id),
    "0001-01-01",
  );

  const rows: NewBalance[] = [];
  for (const account of accounts) {
    const eligible = history.filter((p) => p.accountId === account.id && p.asOf <= closeDay);
    if (eligible.length === 0) continue;
    const latest = eligible.reduce((a, b) =>
      b.asOf > a.asOf || (b.asOf === a.asOf && b.capturedAt > a.capturedAt) ? b : a,
    );
    rows.push({
      accountId: account.id,
      asOf: closeDay,
      balance: latest.balance,
      available: latest.available,
      source: "system",
      capturedAt: now,
    });
  }

  if (rows.length > 0) await deps.accounts.recordBalances(rows);
  return { closed: rows.length };
}

/** The oldest active owner; there is only ever one in practice. */
async function ownerId(): Promise<string | null> {
  const [row] = await db
    .select({ id: users.id })
    .from(users)
    .innerJoin(userRoles, eq(userRoles.userId, users.id))
    .where(and(eq(userRoles.roleCode, "owner"), eq(users.status, "active")))
    .orderBy(asc(users.createdAt))
    .limit(1);
  return row?.id ?? null;
}

async function closeOwner(userId: string, now: Date): Promise<{ closed: number }> {
  return withUserContext(db, { userId, role: "system" }, (tx) =>
    closePreviousMonth({ accounts: new DrizzleAccountsRepository(tx), clock: { now: () => now } }, userId),
  );
}

/**
 * Never throws. Every path ends in a `job_runs` row and a `JobResult`,
 * mirroring `runWalletAccountsSync` — this job syncs no upstream, but it
 * still runs once for the single owner under their own RLS context.
 */
export async function runMonthlyClose(input: RunMonthlyCloseInput): Promise<JobResult> {
  const run = await startRun({ jobName: JOB_NAME, trigger: input.trigger });

  try {
    // No owner is a not-yet-bootstrapped install, not a failure.
    const owner = await ownerId();
    if (!owner) {
      const skipped = { reason: "no_owner" };
      await finishRun(run.id, "already_done", { detail: skipped });
      return { job: JOB_NAME, status: "already_done", detail: skipped };
    }

    const detail = await withJobLock(LOCK_KEY, () => closeOwner(owner, input.now));

    // Lock not acquired: a concurrent invocation owns the close. A `curl
    // --retry` after a timeout lands here, and must not read as an error.
    if (detail === null) {
      const skipped = { reason: "lock_not_acquired" };
      await finishRun(run.id, "already_done", { detail: skipped });
      return { job: JOB_NAME, status: "already_done", detail: skipped };
    }

    await finishRun(run.id, "success", { detail });
    return { job: JOB_NAME, status: "success", detail };
  } catch (err) {
    const error = errorMessage(err);
    await finishRun(run.id, "failed", { error });
    await alertJobFailure({ job: JOB_NAME, error });
    return { job: JOB_NAME, status: "failed", error };
  }
}
