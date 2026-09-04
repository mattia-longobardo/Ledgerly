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
import { runInterestAccrual } from "@/modules/interests/application/run-interest-accrual";
import type { InterestRule } from "@/modules/interests/application/ports";
import { interestDeps } from "@/modules/interests/infrastructure/deps";

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

async function accrueRule(rule: InterestRule, accrualDate: string): Promise<{ accrued: boolean }> {
  return withUserContext(db, { userId: rule.userId, role: "system" }, (tx) =>
    runInterestAccrual(interestDeps(tx))(rule, accrualDate),
  );
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
    let failed = 0;
    for (const rule of rules) {
      try {
        const outcome = await withJobLock(`${LOCK_KEY}:${rule.id}`, () => accrueRule(rule, asOf));
        if (outcome?.accrued) accrued += 1;
      } catch (err) {
        failed += 1;
        console.error(
          JSON.stringify({ level: "error", event: "interest_accrual_rule_failed", ruleId: rule.id, error: errorMessage(err) }),
        );
      }
    }
    const detail = { rulesConsidered: rules.length, accrued, failed };
    await finishRun(run.id, "success", { detail });
    return { job: JOB_NAME, status: "success", detail };
  } catch (err) {
    const error = errorMessage(err);
    await finishRun(run.id, "failed", { error });
    await alertJobFailure({ job: JOB_NAME, error });
    return { job: JOB_NAME, status: "failed", error };
  }
}
