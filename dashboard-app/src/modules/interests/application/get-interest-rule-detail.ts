import type { Principal } from "@/platform/auth/principal";
import { assertPermission } from "@/platform/auth/principal";
import { projectInterest, type ProjectionPoint } from "../domain/accrual";
import { reconcileInterest, type ReconciliationSummary } from "../domain/reconciliation";
import type { InterestAccrual, InterestEntry, InterestRule, UseCaseDeps } from "./ports";
import { NotFoundError } from "./errors";

export interface InterestRuleDetail {
  rule: InterestRule;
  accruals: InterestAccrual[];
  entries: InterestEntry[];
  reconciliation: ReconciliationSummary;
  projection: ProjectionPoint[];
}

/** Inclusive start-of-day UTC boundary for a "YYYY-MM-DD" date string. */
function startOfDay(dateStr: string): Date {
  return new Date(`${dateStr}T00:00:00.000Z`);
}

/** Exclusive end boundary (start of the following day), so all of `dateStr` is included. */
function dayAfter(dateStr: string): Date {
  const d = startOfDay(dateStr);
  d.setUTCDate(d.getUTCDate() + 1);
  return d;
}

export function getInterestRuleDetail(deps: UseCaseDeps) {
  return async (
    principal: Principal,
    id: string,
    opts: { periodStart: string; periodEnd: string; projectionDays?: number },
  ): Promise<InterestRuleDetail> => {
    assertPermission(principal, "interests.read");
    const rule = await deps.rules.get(principal.userId, id);
    if (!rule) throw new NotFoundError();

    const accruals = await deps.accruals.forRule(rule.id, opts.periodStart, opts.periodEnd);

    // `InterestEntriesRepository.listForRule` (Task 15's port) has no
    // date-range parameter, unlike `accruals.forRule` — so the period scope
    // is applied here instead. Without it, a paid entry from outside the
    // requested period would silently leak into this period's
    // reconciliation and could make it look matched (or wrongly anomalous)
    // for the wrong reason.
    const periodFrom = startOfDay(opts.periodStart);
    const periodTo = dayAfter(opts.periodEnd);
    const entries = (await deps.entries.listForRule(rule.id)).filter(
      (e) => e.occurredAt >= periodFrom && e.occurredAt < periodTo,
    );

    const paid = entries.filter((e) => e.kind === "paid").map((e) => ({ occurredAt: e.occurredAt, net: e.net }));
    const reconciliation = reconcileInterest(
      accruals.map((a) => ({
        accrualDate: a.accrualDate,
        net: a.net,
        // Ruling P3-C39 (B2): `postedAt` set but `entryId` still null is the
        // observable signature of a crash between a successful Wallet POST
        // and the local confirm write — surfaced here as `indeterminate`
        // rather than silently reconciling as though nothing happened.
        postingIndeterminate: a.postedAt !== null && a.entryId === null,
      })),
      paid,
      { start: opts.periodStart, end: opts.periodEnd },
    );

    const currentBalance = await deps.balances.latestBalanceAsOf(principal.userId, rule.accountId, opts.periodEnd);
    // `runInterestAccrual` only ever computes for `simple_daily` compounding
    // (a `monthly`/`none` rule is accepted by the schema for forward
    // compatibility but produces no accrual there) — the projection must
    // honor that same gate, or a `monthly`/`none` rule would get a confident
    // multi-day forecast computed with the simple-daily formula for interest
    // the accrual job has explicitly promised never to post.
    const projection =
      currentBalance !== null && rule.compounding === "simple_daily" && rule.dayCount !== "actual"
        ? projectInterest(
            { balance: currentBalance, annualRate: rule.annualRate, taxRate: rule.taxRate, dayCount: rule.dayCount },
            new Date(`${opts.periodEnd}T00:00:00Z`),
            opts.projectionDays ?? 30,
          )
        : [];

    return { rule, accruals, entries, reconciliation, projection };
  };
}
