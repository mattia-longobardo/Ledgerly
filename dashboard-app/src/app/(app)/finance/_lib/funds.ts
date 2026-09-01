import type { MonthPoint } from "@/lib/contracts";
import { cometaCreditedDeposits } from "@/lib/calc/cometa";
import { fromCents, toCents } from "@/lib/calc/money";
import {
  absoluteReturn,
  currentValue,
  effectiveSetting,
  totalDeposited,
  type FundDepositRow,
} from "@/lib/calc/funds";
import { classify } from "@/lib/calc/staleness";
import type { Fund, FundSetting } from "@/lib/db/schema";
import { latestBalances, monthlyHistory } from "@/lib/repo/balances";
import { allDeposits, allSettings, listFunds } from "@/lib/repo/funds";
import { monthKey } from "@/lib/time";

export interface FundView {
  fund: Fund;
  settings: FundSetting[];
  /**
   * The deposits the return figures are built on. Cometa's raw monthly accruals
   * are replaced with its quarterly credited deposits (see `cometaCreditedDeposits`)
   * so not-yet-credited quarters stay out of the denominator; every other fund
   * carries its raw deposits unchanged.
   */
  deposits: FundDepositRow[];
  points: MonthPoint[];
  /** Latest observed Teable value; gaps are not carried forward into figures. */
  value: number | null;
  deposited: number;
  absReturn: number | null;
  capturedAt: Date | null;
  stale: boolean;
  effective: FundSetting | null;
  earliestMonth: string | null;
}

/**
 * The fund's Teable column is cached under a `balance_snapshots.account_key`
 * equal to its slug, so one read covers every fund.
 */
export async function loadFunds(): Promise<FundView[]> {
  const funds = await listFunds();
  if (funds.length === 0) return [];

  const slugs = funds.map((f) => f.slug);
  const [settings, deposits, latest, history] = await Promise.all([
    allSettings(),
    allDeposits(),
    latestBalances(slugs),
    monthlyHistory(slugs),
  ]);

  const now = monthKey(new Date());

  return funds.map((fund) => {
    const fundSettings = settings.filter((s) => s.fundId === fund.id);
    const rawDeposits = deposits.filter((d) => d.fundId === fund.id);
    // Cometa credits quarterly with a lag, so its return must be measured
    // against what has actually been credited — not every monthly accrual.
    const fundDeposits: FundDepositRow[] =
      fund.slug === "cometa"
        ? cometaCreditedDeposits(rawDeposits.map((d) => ({ month: d.month, amount: d.amount })))
        : rawDeposits;
    const points = history
      .filter((h) => h.accountKey === fund.slug)
      .map((h) => ({ month: h.month, value: fromCents(toCents(h.balance)) }))
      .sort((a, b) => (a.month < b.month ? -1 : 1));

    const snapshot = latest.find((l) => l.accountKey === fund.slug) ?? null;
    const info = classify(snapshot?.capturedAt ?? null, "teable");

    const value = currentValue(points, now);
    const deposited = totalDeposited(fundSettings, fundDeposits, now);

    // Raw accrual months here, not the credited ones: the table should span
    // from the first contribution, even though the denominator only counts
    // credited quarters.
    const months = [
      ...points.map((p) => p.month),
      ...rawDeposits.map((d) => d.month),
      ...fundSettings.map((s) => s.effectiveFrom),
    ].sort();

    return {
      fund,
      settings: fundSettings,
      deposits: fundDeposits,
      points,
      value,
      deposited,
      absReturn: absoluteReturn(value, deposited),
      capturedAt: info.capturedAt,
      stale: info.stale,
      effective: effectiveSetting(fundSettings, now),
      earliestMonth: months[0] ?? null,
    };
  });
}

export async function loadFund(slug: string): Promise<FundView | null> {
  const all = await loadFunds();
  return all.find((f) => f.fund.slug === slug) ?? null;
}
