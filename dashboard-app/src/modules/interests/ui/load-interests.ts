import { db } from "@/lib/db";
import { withUserContext } from "@/platform/db/context";
import { accountDeps } from "@/modules/accounts/infrastructure/deps";
import { listAccounts } from "@/modules/accounts/application/list-accounts";
import { NotFoundError } from "../application/errors";
import { getInterestRuleDetail } from "../application/get-interest-rule-detail";
import { listInterestRules } from "../application/list-interest-rules";
import type { InterestRule } from "../application/ports";
import { runForPrincipal } from "./run";

/** Dates are already plain "YYYY-MM-DD" strings on `InterestRule`, so no ISO flattening is needed here. */
export interface RuleRow {
  id: string;
  accountId: string;
  annualRate: string;
  taxRate: string;
  postingMode: string;
  effectiveFrom: string;
  version: number;
  /**
   * Ruling P3-C44 (B6): true for a rule the accrual job will never compute
   * anything for, by construction — `dayCount: "actual"` or `compounding:
   * "monthly"|"none"`. Both remain valid, creatable rule shapes (spec §5.7
   * fidelity, Ruling P3-7); this flag exists only so the rule detail view can
   * say so, rather than leaving a rule that lists, shows an empty
   * projection, and accrues nothing for a month with nothing anywhere
   * stating it is inert.
   */
  inert: boolean;
}

function toRow(rule: InterestRule): RuleRow {
  return {
    id: rule.id,
    accountId: rule.accountId,
    annualRate: rule.annualRate,
    taxRate: rule.taxRate,
    postingMode: rule.postingMode,
    effectiveFrom: rule.effectiveFrom,
    version: rule.version,
    inert: rule.compounding !== "simple_daily" || rule.dayCount === "actual",
  };
}

export async function loadInterestRules(): Promise<RuleRow[]> {
  return runForPrincipal(async (deps, principal) => (await listInterestRules(deps)(principal)).map(toRow));
}

export interface RuleDetailAccrual {
  accrualDate: string;
  net: string;
}

export interface RuleDetailProjectionPoint {
  date: string;
  net: string;
}

export interface RuleDetailData {
  rule: RuleRow;
  accruals: RuleDetailAccrual[];
  /**
   * One of `ReconciliationStatus` ("matched" | "missing" | "delayed" |
   * "anomalous" | "no_data"), carried through untouched from
   * `getInterestRuleDetail`. Kept as a plain string here (rather than
   * importing the domain union) so this module stays the same flat,
   * serialisable shape as the rest of this file — but the value itself is
   * never collapsed or defaulted: `no_data` must reach the page exactly as
   * `no_data`, never coerced into `matched`.
   */
  reconciliationStatus: string;
  projection: RuleDetailProjectionPoint[];
}

export async function loadInterestRuleDetail(
  id: string,
  opts: { periodStart: string; periodEnd: string },
): Promise<RuleDetailData | null> {
  return runForPrincipal(async (deps, principal) => {
    // Only a missing rule renders as "not found" — anything else (a database
    // failure, a permission edge, a bug in the use case) is a real error and
    // must surface as one, not get erased into a 404. This is the same fix
    // the Expenses loader needed after it first swallowed every error this
    // way (see `loadTransactionDetail`).
    const detail = await getInterestRuleDetail(deps)(principal, id, { ...opts, projectionDays: 30 }).catch(
      (err: unknown) => {
        if (err instanceof NotFoundError) return null;
        throw err;
      },
    );
    if (!detail) return null;
    return {
      rule: toRow(detail.rule),
      accruals: detail.accruals.map((a) => ({ accrualDate: a.accrualDate, net: a.net })),
      reconciliationStatus: detail.reconciliation.status,
      projection: detail.projection.map((p) => ({ date: p.date, net: p.net })),
    };
  });
}

export interface EligibleAccount {
  id: string;
  name: string;
}

/**
 * The interests module has no accounts repository of its own, so this loader
 * reuses the accounts module's own use case and deps bag directly — the same
 * cross-module reuse Task 19's job wiring already relies on (`accountDeps`),
 * not a new pattern. It opens its own `withUserContext`, never nested inside
 * `runForPrincipal`'s.
 */
export async function loadEligibleAccounts(): Promise<EligibleAccount[]> {
  const { requirePrincipal } = await import("@/platform/auth/require-principal");
  const principal = await requirePrincipal();
  const items = await withUserContext(db, { userId: principal.userId }, (tx) =>
    listAccounts(accountDeps(tx))(principal, { months: 1 }),
  );
  return items.map((i) => ({ id: i.account.id, name: i.account.name }));
}
