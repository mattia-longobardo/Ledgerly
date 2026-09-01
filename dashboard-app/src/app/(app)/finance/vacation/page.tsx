import Link from "next/link";
import { TimeSeriesChart } from "@/components/chart/TimeSeriesChart";
import { PageGrid, Panel } from "@/components/layout/PageGrid";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { MoneyValue } from "@/components/ui/MoneyValue";
import { balanceSeries, effectiveRate, fundBalance } from "@/lib/calc/vacation-fund";
import type { Series } from "@/lib/contracts";
import { formatEur, formatMonth } from "@/lib/format";
import { balance as ledgerBalance, rates, recentLedger } from "@/lib/repo/vacation";
import { monthKey, romeDate } from "@/lib/time";
import { requireUserOrRedirect } from "@/lib/auth/require-user";
import { FinanceTabs } from "../_components/FinanceTabs";
import { WithdrawalFlow } from "./_components/WithdrawalFlow";

export const dynamic = "force-dynamic";
export const metadata = { title: "Vacation fund" };

const ENTRY_LABEL: Record<string, string> = {
  initial: "Opening value",
  accrual: "Monthly accrual",
  withdrawal: "Withdrawal",
  adjustment: "Adjustment",
};

const DATE_LINE = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  timeZone: "Europe/Rome",
});

export default async function VacationFundPage() {
  await requireUserOrRedirect("/finance/vacation");

  const [entries, total, rateRows] = await Promise.all([
    recentLedger(60),
    ledgerBalance(),
    rates(),
  ]);

  const now = monthKey(new Date());
  const rate = effectiveRate(rateRows, now);
  const series: Series[] = [
    { key: "vacation", label: "Set aside", points: balanceSeries([...entries].reverse()) },
  ];
  const configured = rateRows.length > 0 || entries.length > 0;

  return (
    <>
      <PageHeader title="Vacation fund" segmented={<FinanceTabs />} />

      {!configured ? (
        <div className="max-w-xl pt-6">
          <EmptyState
            title="The vacation fund is not set up"
            description="Set the monthly amount and the opening value once, in settings. There is no preset."
            action={
              <Link
                href="/settings"
                className="inline-flex min-h-11 items-center rounded-md bg-accent px-4 text-body-sm font-medium text-accent-contrast transition-colors hover:bg-accent-hover"
              >
                Set it up
              </Link>
            }
          />
        </div>
      ) : (
        <PageGrid className="pt-5">
          <Panel span={5} ariaLabel="Balance set aside">
            <div className="axis-rule-live pb-6">
              <div className="text-caption tracking-wide text-fg-muted uppercase">Set aside</div>
              <MoneyValue value={total} size="display" cents="muted" />
              <p className="num mt-2 text-body-sm text-fg-muted">
                {rate === null ? "No accrual rule set" : `+${formatEur(rate)} a month`}
              </p>
            </div>

            <h2 className="mt-5 text-caption tracking-wide text-fg-muted uppercase">By month</h2>
            <TimeSeriesChart
              series={series}
              label="Vacation fund balance by month"
              height={260}
              area
              className="mt-3"
            />
          </Panel>

          {/* The withdrawal flow is the reason this screen exists, so it gets
              the wider half rather than a button under a chart. */}
          <Panel span={7} title="Record a withdrawal" chrome="framed">
            <WithdrawalFlow balance={fundBalance(entries)} today={romeDate()} />
          </Panel>

          <Panel span={7} title="History">
            {entries.length === 0 ? (
              <p className="text-body-sm text-fg-muted">Nothing recorded yet.</p>
            ) : (
              <ul className="hairline-t">
                {entries.map((entry) => (
                  <li key={entry.id} className="flex min-h-11 items-center gap-3 py-2 hairline-b">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-body text-fg">
                        {entry.note ?? ENTRY_LABEL[entry.entryType] ?? entry.entryType}
                      </span>
                      <span className="num block text-caption text-fg-muted">
                        {entry.month === null
                          ? DATE_LINE.format(entry.occurredAt)
                          : formatMonth(entry.month)}
                        {" · "}
                        {ENTRY_LABEL[entry.entryType] ?? entry.entryType}
                      </span>
                    </span>
                    <MoneyValue
                      value={entry.amount}
                      size="body"
                      className={entry.amount.startsWith("-") ? "text-negative" : "text-positive"}
                    />
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </PageGrid>
      )}
    </>
  );
}
