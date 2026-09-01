import { addMonths, monthKey } from "@/lib/time";
import { cometaSchedule, creditedByMonth } from "@/lib/calc/cometa";
import { fromCents, toCents } from "@/lib/calc/money";
import { combinedGain, type FundSeries, type GainRow, type GainTotal } from "@/lib/calc/portfolio";
import { monthlyHistory } from "@/lib/repo/balances";
import { allDeposits, allSettings, listFunds } from "@/lib/repo/funds";

export interface PortfolioGain {
  perFund: { key: string; label: string; rows: GainRow[]; total: GainTotal }[];
  combined: GainRow[];
  combinedTotal: GainTotal;
  /** Costs Cometa deducted before buying units — never a gain or a loss. */
  cometaFees: number;
  error?: string;
}

const EMPTY: PortfolioGain = {
  perFund: [],
  combined: [],
  combinedTotal: { abs: 0, pct: null },
  cometaFees: 0,
};

/** Initial capital of the earliest settings row, in euro. */
function initialCapitalOf(settings: { effectiveFrom: string; initialCapital: string }[]): number {
  let earliest: (typeof settings)[number] | undefined;
  for (const s of settings) {
    if (!earliest || s.effectiveFrom < earliest.effectiveFrom) earliest = s;
  }
  return fromCents(toCents(earliest?.initialCapital) ?? 0);
}

/**
 * Month-by-month gain on the two funds, reconciled to the cards.
 *
 * Values come from `balance_snapshots` — the very series the cards read — so the
 * euro column sums, to the cent, to each card's lifetime absolute gain. The
 * whole recorded history is now cached there, so the table spans the year from
 * each fund's first funded month rather than clipping to the first scored one.
 *
 * Deposits are keyed by the month the money becomes *visible* in those values,
 * which is what the differencing actually needs. Two lags compose: Cometa only
 * credits quarterly, in the month after the quarter closes, and every recorded
 * value describes the end of the month before it. Booking a contribution in its
 * accrual month would put it in the denominator up to five months early.
 */
export async function loadPortfolioGain(): Promise<PortfolioGain> {
  try {
    const funds = await listFunds();
    if (funds.length === 0) return EMPTY;

    const slugs = funds.map((f) => f.slug);
    const [deposits, settings, history] = await Promise.all([
      allDeposits(),
      allSettings(),
      monthlyHistory(slugs),
    ]);

    let cometaFees = 0;
    const series: FundSeries[] = funds.map((fund) => {
      const own = deposits.filter((d) => d.fundId === fund.id);
      const fundSettings = settings.filter((s) => s.fundId === fund.id);

      const values = history
        .filter((h) => h.accountKey === fund.slug)
        .map((h) => ({ month: h.month, value: fromCents(toCents(h.balance)) }))
        .sort((a, b) => (a.month < b.month ? -1 : 1));

      let credited: Map<string, number>;
      if (fund.slug === "cometa") {
        const schedule = cometaSchedule(own.map((d) => ({ month: d.month, amount: d.amount })));
        // Only fees ACTUALLY charged: a quarter whose credit is still in the
        // future (Q3, visible Nov) has not been deducted and is held out of the
        // deposited base and the table — counting its €3 in the costs note would
        // overstate the cost against what is really invested, the same mismatch
        // the whole reconciliation set out to remove.
        const asOf = monthKey();
        cometaFees = Number(
          schedule
            .filter((c) => c.visibleMonth <= asOf)
            .reduce((s, c) => s + c.fees, 0)
            .toFixed(2),
        );
        credited = creditedByMonth(schedule);
      } else {
        // Fideuram is paid in monthly, so the accrual month *is* the credit
        // month — but a recorded value still lags a month behind the position
        // it describes, so the money shows up one month later here too. Without
        // the shift a whole 250 € deposit is mistaken for performance.
        credited = new Map(own.map((d) => [addMonths(d.month, 1), Number(d.amount)]));
      }

      return {
        key: fund.slug,
        label: fund.name,
        values,
        credited,
        initialCapital: initialCapitalOf(fundSettings),
      };
    });

    return { ...combinedGain(series), cometaFees };
  } catch (err) {
    // A read failure must not take the page down: the rest of the Finance view
    // is served from the same Postgres and stays useful.
    return { ...EMPTY, error: err instanceof Error ? err.message : String(err) };
  }
}
