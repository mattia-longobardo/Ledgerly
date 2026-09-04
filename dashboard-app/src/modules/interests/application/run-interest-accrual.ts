import { dailyInterest } from "../domain/accrual";
import type { InterestRule, UseCaseDeps } from "./ports";

function previousDay(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

export interface RunInterestAccrualResult {
  accrued: boolean;
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
export function runInterestAccrual(deps: UseCaseDeps) {
  return async (rule: InterestRule, accrualDate: string): Promise<RunInterestAccrualResult> => {
    if (rule.compounding !== "simple_daily" || rule.dayCount === "actual") return { accrued: false };
    const balance = await deps.balances.latestBalanceAsOf(rule.userId, rule.accountId, accrualDate);
    // "There was no balance to compute against" and "the interest for that
    // day was zero" are different facts — this returns before `dailyInterest`
    // is ever called and before `accruals.upsert` is ever reached, so a day
    // with no balance basis gets no accrual row at all, not a fabricated
    // `net: "0.00"` one that would later reconcile as though a real zero had
    // been computed.
    if (balance === null) return { accrued: false };

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
