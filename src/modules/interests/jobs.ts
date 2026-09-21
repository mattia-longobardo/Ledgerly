import "server-only";
import { and, asc, eq } from "drizzle-orm";
import { forEachUser } from "@/modules/users/jobs";
import type { Ctx } from "@/platform/context";
import { getDb } from "@/platform/db/client";
import { userScoped } from "@/platform/db/scope";
import type { JobDefinition } from "@/platform/jobs/registry";
import type { JobDetail } from "@/platform/jobs/schema";
import { interestRules } from "./schema";
import { ensureFreshBalances, type FreshnessOptions, type StaleReason } from "./freshness";
import { postPending } from "./posting";
import { runsAt } from "./rules";
import { bringUpToDate } from "./service";

/**
 * Every hour (spec §10.2, tier `hourly`), each rule accrued once a day at **its own** hour: a pass
 * takes only the active rules whose hour — `run_hour`, or noon when it has none — is the hour the
 * clock shows *in the owner's zone*, never the server's. A rule with no hour set therefore still
 * accrues once a day at 12:00 local, exactly as the daily job did.
 *
 * What it does for a rule is unchanged: accrued up to yesterday — the day whose balance is closed
 * — and the periods that have ended settled, a missed day caught up on the next pass, in order.
 * One row per rule and day, so a second pass in the same hour (or the same day) writes nothing
 * twice. Then the settlements of the rules that publish are posted to Wallet (spec §7.6), with no
 * transaction open while Wallet is called; that too only in a pass that had a rule to accrue.
 *
 * The hourly tick is Europe/Rome (cron/crontab): the hour a zone skips when it springs forward has
 * no pass of its own, and the hour it repeats when it falls back has two — harmless, being
 * idempotent.
 *
 * **Before a rule accrues, its balance is made fresh** (spec §7.6): the Wallet connection of every
 * synced account the due rules touch is synchronised once — `ensureFreshBalances`, one pass per
 * connection per tick, through the lock `syncWalletNow` already holds — and the pass is waited
 * for. A rule whose account came back with a reading too old to trust is **not** accrued: it is
 * counted in `stale` with the reason, and the rule's own page says the accrual is on hold, rather
 * than a wrong number being produced, settled and published in silence. A manual account has
 * nothing to synchronise and accrues as it always did.
 */
/** What one user's pass did, so the job can add the users up and a test can drive one of them. */
export interface AccrualPass {
  /** Rules brought up to date. */
  rules: number;
  /** Settlements published to Wallet. */
  posted: number;
  /** Rules left alone because their balance was not one to accrue on. */
  stale: number;
  reasons: StaleReason[];
}

/**
 * One user's due rules, accrued on a balance that has just been made fresh (spec §7.6).
 *
 * Exported so an integration test can drive a pass with a fake Wallet (`options.sync`) instead of
 * the real one: the job itself takes no arguments, and a seam is cheaper than a job that reads a
 * global to know whether it is being tested.
 */
export async function accrueDueRules(
  ctx: Ctx,
  now: Date,
  options: FreshnessOptions = {},
): Promise<AccrualPass> {
  const pass: AccrualPass = { rules: 0, posted: 0, stale: 0, reasons: [] };
  const active = await getDb()
    .select({
      id: interestRules.id,
      accountId: interestRules.accountId,
      runHour: interestRules.runHour,
    })
    .from(interestRules)
    .where(and(userScoped(ctx).owns(interestRules), eq(interestRules.state, "active")))
    .orderBy(asc(interestRules.id));
  const due = active.filter((rule) => runsAt(rule.runHour, now, ctx.timeZone));
  if (due.length === 0) return pass;

  // One Wallet pass per connection, however many rules of this user are due on it.
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
  // Publishing comes after, outside every transaction; an unsure posting is left as it is.
  pass.posted += await postPending(ctx);
  return pass;
}

export const interestsAccrualJob: JobDefinition = {
  name: "interests-accrual",
  tier: "hourly",
  async run(): Promise<JobDetail> {
    const now = new Date();
    let rules = 0;
    let posted = 0;
    let stale = 0;
    const reasons = new Set<StaleReason>();
    const counts = await forEachUser("interests-accrual", async (_person, ctx) => {
      const pass = await accrueDueRules(ctx, now);
      rules += pass.rules;
      posted += pass.posted;
      stale += pass.stale;
      for (const reason of pass.reasons) reasons.add(reason);
    });
    return {
      ...counts,
      rules,
      posted,
      stale,
      // Why the skipped ones were skipped, once each: the run's own account of a pass that found
      // nothing fresh to accrue on, without a row per rule in a job detail.
      staleReasons: reasons.size === 0 ? null : [...reasons].sort().join(", "),
    };
  },
};
