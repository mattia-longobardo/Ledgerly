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
import { postWalletInterestEntry, WALLET_PROVIDER } from "@/modules/interests/infrastructure/wallet-interest-posting-adapter";

export const JOB_NAME = "interest_accrual" as const;

/** One instance at a time, per rule: the crontab entry uses `curl --retry`. */
export const LOCK_KEY = JOB_NAME;

export interface RunInterestAccrualJobInput {
  trigger: "cron" | "manual";
  now: Date;
}

/**
 * How far back `tryPost` will look for an unposted, posting-eligible accrual
 * on top of today's — bounded so a rule stuck broken (a stale link, a
 * revoked connection) accumulates a capped backlog to sweep rather than an
 * ever-growing one. 30 days covers any outage this system is realistically
 * expected to self-heal from before someone notices.
 */
const POST_LOOKBACK_DAYS = 30;

/**
 * A post-phase failure means money may already be at Wallet while the local
 * ledger is not yet caught up — a materially different situation from an
 * ordinary accrual failure (a bad rate, a missing balance). Reported
 * distinctly in the job loop: alerted immediately, and counted apart from
 * `failed` in `detail`.
 */
class PostFailedError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "PostFailedError";
  }
}

function daysBefore(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

async function activeRules(asOf: string): Promise<InterestRule[]> {
  return withSystemContext(db, (tx) => interestDeps(tx).rules.listActiveForAllUsers(asOf));
}

/**
 * Posts every currently-unposted, posting-eligible accrual for `rule` within
 * `POST_LOOKBACK_DAYS` of `accrualDate` — not just today's — so a Wallet
 * outage or a temporarily-missing connection does not silently and
 * permanently lose that day's posting once the underlying problem clears.
 *
 * Every read here (the candidate accruals, the provider link) is its own
 * short `withUserContext` transaction, closed before the next step starts;
 * so is each accrual's final write. `shouldPost` is the idempotency gate —
 * an accrual already carrying `postedAt`/`entryId` is filtered out here, and
 * `postWalletInterestEntry` itself asks Wallet for an existing record before
 * ever posting again, closing the window where a previous run's crash left
 * local state saying "not yet posted" after Wallet already has it.
 *
 * This function's *own* transactions are never held across the Wallet round
 * trip — but the job loop's `withJobLock` (in `runInterestAccrualJob`,
 * below) wraps this whole function in one that is: an advisory-lock
 * transaction held for the entire call, Wallet round trip included. That is
 * deliberate, not an oversight — it is exactly what stops two concurrent
 * runs of this same rule from racing to post (the second run's non-blocking
 * `pg_try_advisory_xact_lock` fails immediately and skips the rule for that
 * tick), the same shape `wallet-accounts-sync.ts` already documents and
 * relies on for its own provider round trip.
 */
async function tryPost(rule: InterestRule, accrualDate: string): Promise<number> {
  const from = daysBefore(accrualDate, POST_LOOKBACK_DAYS);
  const candidates = await withUserContext(db, { userId: rule.userId, role: "system" }, (tx) =>
    interestDeps(tx).accruals.forRule(rule.id, from, accrualDate),
  );
  const eligible = candidates.filter((a) => shouldPost(rule, a));
  if (eligible.length === 0) return 0;

  const link = await withUserContext(db, { userId: rule.userId, role: "system" }, (tx) => accountDeps(tx).links.liveFor("account", rule.accountId));
  // `liveFor` matches on entity type/id and "not missing" only — it does not
  // filter by provider, so a link to some other provider on the same
  // account must be rejected explicitly before its `externalId` is ever
  // trusted as a Wallet account id.
  if (!link || link.provider !== WALLET_PROVIDER) {
    console.warn(
      JSON.stringify({ level: "warn", event: "interest_post_skipped", ruleId: rule.id, reason: "no_live_wallet_link", pending: eligible.length }),
    );
    return 0;
  }

  const opened = await openConnection(integrationDeps(db))(rule.userId, "wallet");
  if (!opened) {
    console.warn(
      JSON.stringify({ level: "warn", event: "interest_post_skipped", ruleId: rule.id, reason: "wallet_not_connected", pending: eligible.length }),
    );
    return 0;
  }
  const token = opened.credentials.token;
  if (!token) {
    // A connection that is `connected` but has no stored token is a data
    // problem, not "Wallet rejected us" — skip and say so plainly rather
    // than sending `Bearer undefined` and letting the resulting 401 read as
    // an authentication rejection it never was.
    console.warn(
      JSON.stringify({
        level: "warn",
        event: "interest_post_skipped",
        ruleId: rule.id,
        reason: "wallet_connection_missing_token",
        pending: eligible.length,
      }),
    );
    return 0;
  }

  let postedCount = 0;
  for (const accrual of eligible) {
    try {
      const posted = await postWalletInterestEntry({ token, walletAccountId: link.externalId, rule, accrual });
      // `recordPostedEntry` creates the paid entry and marks the accrual
      // posted in one transaction; if `markPosted` reports it affected no
      // row, it throws rather than returning — this money has already
      // reached Wallet, so that failure must surface loudly (as a
      // `PostFailedError`, caught distinctly by the job loop below) rather
      // than be swallowed as a quiet skip.
      await withUserContext(db, { userId: rule.userId, role: "system" }, (tx) =>
        recordPostedEntry(interestDeps(tx))(rule, accrual, posted.note, posted.transactionId),
      );
      postedCount += 1;
    } catch (err) {
      throw new PostFailedError(
        `interest post failed for rule ${rule.id} on accrual ${accrual.accrualDate} (${postedCount} of ${eligible.length} posted this run): ${errorMessage(err)}`,
        { cause: err },
      );
    }
  }
  return postedCount;
}

async function accrueRule(rule: InterestRule, accrualDate: string): Promise<{ accrued: boolean; posted: number }> {
  const result = await withUserContext(db, { userId: rule.userId, role: "system" }, (tx) =>
    runInterestAccrual(interestDeps(tx))(rule, accrualDate),
  );
  if (!result.accrued) return { accrued: false, posted: 0 };
  const posted = await tryPost(rule, accrualDate);
  return { accrued: true, posted };
}

/**
 * Never throws past this function. Every path ends in a `job_runs` row and a
 * `JobResult`. One rule's failure — including `dailyInterest` throwing on a
 * rule already in the database with a negative `annualRate` or an
 * out-of-range `taxRate` (Task 14's contract change; `run-interest-accrual.ts`
 * deliberately does not catch that itself) — is caught and logged per-rule so
 * it cannot jam every other user's accrual for the day. A post-phase failure
 * (`PostFailedError`) is caught the same way but alerted on immediately and
 * counted apart from `failed`, since it means money may already be at Wallet
 * while the local ledger has not caught up.
 */
export async function runInterestAccrualJob(input: RunInterestAccrualJobInput): Promise<JobResult> {
  const run = await startRun({ jobName: JOB_NAME, trigger: input.trigger });
  try {
    const asOf = romeDate(input.now);
    const rules = await activeRules(asOf);
    let accrued = 0;
    let posted = 0;
    let failed = 0;
    let postFailed = 0;
    for (const rule of rules) {
      try {
        const outcome = await withJobLock(`${LOCK_KEY}:${rule.id}`, () => accrueRule(rule, asOf));
        if (outcome?.accrued) accrued += 1;
        if (outcome?.posted) posted += outcome.posted;
      } catch (err) {
        if (err instanceof PostFailedError) {
          postFailed += 1;
          const error = errorMessage(err);
          console.error(JSON.stringify({ level: "error", event: "interest_post_failed", ruleId: rule.id, error }));
          await alertJobFailure({ job: JOB_NAME, error: `rule ${rule.id}: ${error}` });
        } else {
          failed += 1;
          console.error(
            JSON.stringify({ level: "error", event: "interest_accrual_rule_failed", ruleId: rule.id, error: errorMessage(err) }),
          );
        }
      }
    }
    const detail = { rulesConsidered: rules.length, accrued, posted, failed, postFailed };
    await finishRun(run.id, "success", { detail });
    return { job: JOB_NAME, status: "success", detail };
  } catch (err) {
    const error = errorMessage(err);
    await finishRun(run.id, "failed", { error });
    await alertJobFailure({ job: JOB_NAME, error });
    return { job: JOB_NAME, status: "failed", error };
  }
}
