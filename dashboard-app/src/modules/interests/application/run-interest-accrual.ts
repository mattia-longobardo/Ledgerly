import { dailyInterest } from "../domain/accrual";
import type { InterestRule, UseCaseDeps } from "./ports";

function previousDay(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Ruling P3-C44 (B6): the schema, the DB check constraints and the public API
 * all deliberately accept `dayCount: "actual"` and `compounding: "monthly" |
 * "none"` (spec §5.7 fidelity, Ruling P3-7) even though this use case never
 * computes an accrual for them — and never will, until a later phase adds
 * that math. A rule stuck in one of those states, or one with no balance on
 * file for a given day, used to produce `{accrued: false}` with nothing
 * anywhere saying why. These reasons are surfaced in the job's `detail` (see
 * `interest-accrual.ts`) so "this rule does nothing, forever" is visible
 * instead of silent.
 */
export type AccrualSkipReason = "unsupported_compounding" | "unsupported_day_count" | "no_balance" | "negative_balance";

export interface RunInterestAccrualResult {
  accrued: boolean;
  skipReason?: AccrualSkipReason;
}

/**
 * One rule, one day, idempotent via `accruals.upsert`'s conflict target on
 * (ruleId, accrualDate) — that upsert always keeps whatever `postedAt`/
 * `entryId` are already on the row (Ruling P3-16), and this use case always
 * passes `postedAt: null, entryId: null` regardless of whether the day was
 * already posted, so re-running the job over an already-posted day
 * recomputes the numbers but never resets or re-triggers a posting.
 *
 * Only `simple_daily` compounding over a fixed `dayCount` is computed in
 * Phase 3 (spec §7.6 reuses the legacy script's exact algorithm, which is
 * simple daily only) — a rule using another value is accepted by the schema
 * for forward compatibility but produces no accrual here. A missing account
 * balance produces no accrual either: never invent financial data.
 *
 * Contract change (Task 14 review): `dailyInterest` now throws on a negative
 * `annualRate` or a `taxRate` outside [0, 1] instead of silently flooring to
 * zero. `createInterestRule`/`updateInterestRule` reject those values before
 * they are ever persisted, so a rule read back from the repository here
 * should never trigger that throw. If one somehow does, it is a genuine data
 * integrity problem — deliberately not caught and folded into
 * `{ accrued: false }`, which would make it indistinguishable from "no
 * balance on file" or "unsupported compounding" and hide the bad row.
 */
/**
 * A plain, single-dot decimal string with an optional leading "-" — the
 * shape `AccountBalanceLookup.latestBalanceAsOf` always returns (a Postgres
 * `numeric` rendering). Checking the sign this way, rather than `Number()`,
 * costs nothing extra: it never needs to parse the magnitude at all.
 */
function isNegativeAmount(value: string): boolean {
  return value.trim().startsWith("-");
}

export function runInterestAccrual(deps: UseCaseDeps) {
  return async (rule: InterestRule, accrualDate: string): Promise<RunInterestAccrualResult> => {
    if (rule.compounding !== "simple_daily") return { accrued: false, skipReason: "unsupported_compounding" };
    if (rule.dayCount === "actual") return { accrued: false, skipReason: "unsupported_day_count" };
    const balance = await deps.balances.latestBalanceAsOf(rule.userId, rule.accountId, accrualDate);
    // "There was no balance to compute against" and "the interest for that
    // day was zero" are different facts — this returns before `dailyInterest`
    // is ever called and before `accruals.upsert` is ever reached, so a day
    // with no balance basis gets no accrual row at all, not a fabricated
    // `net: "0.00"` one that would later reconcile as though a real zero had
    // been computed.
    if (balance === null) return { accrued: false, skipReason: "no_balance" };

    // Ruling P3-C43 (B5), a deliberate divergence from `interest.py`/
    // `dailyInterest`'s own port: `dailyInterest` clamps a negative total to
    // `net: "0.00"` but still carries the *whole* negative remainder forward
    // (see that function's doc comment) — correct for a single bad day, but
    // an account that stays overdrawn for weeks accumulates an
    // ever-more-negative carry that keeps silently eating real interest for
    // days *after* the balance turns positive again, every one of those days
    // reconciling as `matched` (0.00 accrued, 0.00 paid) with no signal
    // anywhere that a debt is being worked off. Skipping the day entirely —
    // no row, no carry written — sidesteps that class of bug outright: the
    // very next positive-balance day finds a gap in the daily chain (no
    // accrual dated `accrualDate`'s predecessor) and restarts the carry at
    // zero via the existing gap-reset logic below, rather than inheriting a
    // poisoned negative number.
    if (isNegativeAmount(balance)) return { accrued: false, skipReason: "negative_balance" };

    const prior = await deps.accruals.latestCarry(rule.id);
    // Only an unbroken daily chain's carry is trusted; a gap (a missed run, a
    // brand-new rule) restarts the sub-cent carry at zero rather than
    // guessing what happened on the missing days.
    const carry = prior && prior.accrualDate === previousDay(accrualDate) ? prior.carryAfter : "0";

    const computed = dailyInterest({ balance, annualRate: rule.annualRate, taxRate: rule.taxRate, dayCount: rule.dayCount, carry });
    await deps.accruals.upsert({
      ruleId: rule.id,
      accrualDate,
      balanceBasis: balance,
      gross: computed.gross,
      tax: computed.tax,
      net: computed.net,
      carryAfter: computed.carryAfter,
      source: "computed",
      postedAt: null,
      entryId: null,
    });
    await deps.audit({
      actorUserId: rule.userId,
      action: "interests.accrued",
      entityType: "interest_rule",
      entityId: rule.id,
      after: { accrualDate, net: computed.net },
    });
    return { accrued: true };
  };
}
