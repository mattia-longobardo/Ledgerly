/**
 * Daily interest accrual, in the shape of `monthly-close.ts` — passive,
 * idempotent, one `job_runs` row per tick — but iterating every user with an
 * active rule rather than a single owner, since interest rules are per-user
 * from the start (unlike the accounts module's Phase-1-era single-owner
 * jobs).
 *
 * `InterestRulesRepository.listActiveForAllUsers` is read once under
 * `withSystemContext` (RLS's `app_is_system()` bypass, needed because this
 * crosses every user), then each rule's actual accrual runs inside its own
 * `withUserContext` for that rule's `userId` — the two contexts are never
 * nested, only ever called one after another. One rule's failure is caught
 * and logged per-rule (Phase 2 ledger's "a loop over many owners needs
 * per-item error isolation" lesson) rather than aborting the whole run.
 */
import { alertJobFailure } from "@/lib/clients/gotify";
import { errorMessage } from "@/lib/clients/http";
import type { JobResult } from "@/lib/contracts";
import { db } from "@/lib/db";
import { romeDate } from "@/lib/time";
import { finishRun, startRun, withJobLock } from "@/lib/repo/jobs";
import { withSystemContext, withUserContext } from "@/platform/db/context";
import { accountDeps } from "@/modules/accounts/infrastructure/deps";
import { integrationDeps } from "@/modules/integrations/infrastructure/deps";
import { openConnection } from "@/modules/integrations/application/open-connection";
import { runInterestAccrual } from "@/modules/interests/application/run-interest-accrual";
import { recordPostedEntry, shouldPost } from "@/modules/interests/application/post-interest-entry";
import type { InterestRule } from "@/modules/interests/application/ports";
import { interestDeps } from "@/modules/interests/infrastructure/deps";
import { postWalletInterestEntry } from "@/modules/interests/infrastructure/wallet-interest-posting-adapter";

export const JOB_NAME = "interest_accrual" as const;

/** One instance at a time, per rule: the crontab entry uses `curl --retry`. */
export const LOCK_KEY = JOB_NAME;

export interface RunInterestAccrualJobInput {
  trigger: "cron" | "manual";
  now: Date;
}

async function activeRules(asOf: string): Promise<InterestRule[]> {
  return withSystemContext(db, (tx) => interestDeps(tx).rules.listActiveForAllUsers(asOf));
}

/**
 * Every read here is its own short transaction, sequential and never nested;
 * the Wallet call itself runs with none of them open — the same fetch/apply
 * split the sync engine already follows for every provider round trip
 * (`src/modules/integrations/application/run-sync.ts`).
 *
 * `shouldPost` is the idempotency gate: an accrual already carrying
 * `postedAt`/`entryId` is never posted again, and re-reading the accrual
 * fresh here (rather than trusting a value threaded through from
 * `runInterestAccrual`) means a concurrent post recorded between the accrual
 * and this call is picked up. Two concurrent runs of this same rule cannot
 * both reach the Wallet call in the first place: the job loop wraps this
 * whole function (via `accrueRule`) in `withJobLock(`${LOCK_KEY}:${rule.id}`,
 * ...)`, a Postgres advisory lock that the second run's non-blocking
 * `pg_try_advisory_xact_lock` fails to acquire, so it skips the rule for
 * this tick entirely rather than racing the first run to post.
 */
async function tryPost(rule: InterestRule, accrualDate: string): Promise<boolean> {
  const [accrual] = await withUserContext(db, { userId: rule.userId, role: "system" }, (tx) =>
    interestDeps(tx).accruals.forRule(rule.id, accrualDate, accrualDate),
  );
  if (!accrual || !shouldPost(rule, accrual)) return false;

  const link = await withUserContext(db, { userId: rule.userId, role: "system" }, (tx) => accountDeps(tx).links.liveFor("account", rule.accountId));
  if (!link) return false; // not a currently-live synced Wallet account: analyse only

  const opened = await openConnection(integrationDeps(db))(rule.userId, "wallet");
  if (!opened) return false; // Wallet not connected: analyse only

  const posted = await postWalletInterestEntry({ token: opened.credentials.token!, walletAccountId: link.externalId, rule, accrual });

  // `recordPostedEntry` creates the paid entry and marks the accrual posted
  // in one transaction; if `markPosted` reports it affected no row, it
  // throws rather than returning — this money has already reached Wallet,
  // so that failure must surface loudly (caught per-rule by the job loop,
  // below) rather than be swallowed as a quiet `posted: false`.
  await withUserContext(db, { userId: rule.userId, role: "system" }, (tx) => recordPostedEntry(interestDeps(tx))(rule, accrual, posted.note));
  return true;
}

async function accrueRule(rule: InterestRule, accrualDate: string): Promise<{ accrued: boolean; posted: boolean }> {
  const result = await withUserContext(db, { userId: rule.userId, role: "system" }, (tx) =>
    runInterestAccrual(interestDeps(tx))(rule, accrualDate),
  );
  if (!result.accrued) return { accrued: false, posted: false };
  const posted = await tryPost(rule, accrualDate);
  return { accrued: true, posted };
}

/**
 * Never throws past this function. Every path ends in a `job_runs` row and a
 * `JobResult`. One rule's failure — including `dailyInterest` throwing on a
 * rule already in the database with a negative `annualRate` or an
 * out-of-range `taxRate` (Task 14's contract change; `run-interest-accrual.ts`
 * deliberately does not catch that itself) — is caught and logged per-rule so
 * it cannot jam every other user's accrual for the day.
 */
export async function runInterestAccrualJob(input: RunInterestAccrualJobInput): Promise<JobResult> {
  const run = await startRun({ jobName: JOB_NAME, trigger: input.trigger });
  try {
    const asOf = romeDate(input.now);
    const rules = await activeRules(asOf);
    let accrued = 0;
    let posted = 0;
    let failed = 0;
    for (const rule of rules) {
      try {
        const outcome = await withJobLock(`${LOCK_KEY}:${rule.id}`, () => accrueRule(rule, asOf));
        if (outcome?.accrued) accrued += 1;
        if (outcome?.posted) posted += 1;
      } catch (err) {
        failed += 1;
        console.error(
          JSON.stringify({ level: "error", event: "interest_accrual_rule_failed", ruleId: rule.id, error: errorMessage(err) }),
        );
      }
    }
    const detail = { rulesConsidered: rules.length, accrued, posted, failed };
    await finishRun(run.id, "success", { detail });
    return { job: JOB_NAME, status: "success", detail };
  } catch (err) {
    const error = errorMessage(err);
    await finishRun(run.id, "failed", { error });
    await alertJobFailure({ job: JOB_NAME, error });
    return { job: JOB_NAME, status: "failed", error };
  }
}
