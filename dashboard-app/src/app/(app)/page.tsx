import Link from "next/link";
import { Sparkline } from "@/components/chart/Sparkline";
import { PageHeader } from "@/components/layout/PageHeader";
import { AccountRow } from "@/components/ui/AccountRow";
import { DeltaBadge } from "@/components/ui/DeltaBadge";
import { EmptyState } from "@/components/ui/EmptyState";
import { MoneyValue } from "@/components/ui/MoneyValue";
import { ProgressRing } from "@/components/ui/ProgressRing";
import { StaleBadge } from "@/components/ui/StaleBadge";
import { carryForward, deltaOverRange } from "@/lib/calc/series";
import { formatDateLine, formatDays, formatNumber } from "@/lib/format";
import { requireUserOrRedirect } from "@/lib/auth/require-user";
import { loadAccounts, type AccountView } from "./_lib/accounts";
import { loadFerie } from "./_lib/vacation";

export const dynamic = "force-dynamic";
export const metadata = { title: "Home" };

function spark(account: AccountView) {
  return <Sparkline values={carryForward(account.points).map((p) => p.value)} />;
}

function SettingsLink() {
  return (
    <Link
      href="/settings"
      aria-label="Settings"
      className="inline-flex size-11 items-center justify-center rounded-md border border-border bg-surface text-fg-muted"
    >
      <svg
        aria-hidden
        viewBox="0 0 20 20"
        width={18}
        height={18}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <circle cx={10} cy={10} r={2.75} />
        <path d="M10 2.5v1.75M10 15.75v1.75M2.5 10h1.75M15.75 10h1.75M4.7 4.7l1.24 1.24M14.06 14.06l1.24 1.24M15.3 4.7l-1.24 1.24M5.94 14.06 4.7 15.3" />
      </svg>
    </Link>
  );
}

function NavCard({ href, title, detail }: { href: string; title: string; detail: string }) {
  return (
    <Link
      href={href}
      className="flex min-h-24 flex-col justify-between rounded-md border border-border bg-surface p-4"
    >
      <span className="flex items-center justify-between gap-2">
        <span className="text-heading-sm text-fg">{title}</span>
        <svg
          aria-hidden
          viewBox="0 0 20 20"
          width={18}
          height={18}
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          className="text-fg-muted"
        >
          <path d="M7.5 4.5 13 10l-5.5 5.5" />
        </svg>
      </span>
      <span className="text-body-sm text-fg-muted">{detail}</span>
    </Link>
  );
}

export default async function HomePage() {
  await requireUserOrRedirect("/");

  const [accounts, ferie] = await Promise.all([loadAccounts(), loadFerie()]);
  const { total, managed, revolutSubs, handTracked } = accounts;
  const visibleHandTracked = handTracked.filter((a) => a.visible);
  const delta = deltaOverRange(total.points, 1);

  const remainingDays = ferie.remaining.combinedDays;
  const ringMax = (remainingDays ?? 0) + ferie.takenDaysYtd;

  return (
    <main className="pb-8">
      <PageHeader
        title="Total balance"
        eyebrow={formatDateLine(new Date())}
        action={<SettingsLink />}
      />

      <div className="lg:grid lg:grid-cols-2 lg:items-start lg:gap-6 lg:px-4">
        <section className="lg:contents">
          {/* Hero — net worth, summed here from the latest known value of every
              account: the four the app reads plus the five hand-tracked ones.
              Teable's TOTAL column is deliberately not used; its formula omits
              Fondo Cometa, and on the rows this app appends (Date + ING +
              Revolut only) it omits every hand-tracked account too. The chart
              below is built from the same sum, so the two always agree. */}
          <div className="px-4 pb-5 lg:col-start-1 lg:px-0">
            {total.balance === null ? (
              <EmptyState
                title="No balances yet"
                description="Nothing has been snapshotted from Teable or Wallet so far. Run the snapshot job once and this page fills in."
                action={
                  <Link
                    href="/settings"
                    className="inline-flex min-h-11 items-center rounded-md bg-accent px-4 text-body-sm font-medium text-accent-contrast"
                  >
                    Open settings
                  </Link>
                }
              />
            ) : (
              <>
                <MoneyValue value={total.balance} size="display" cents="muted" />
                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
                  {delta.abs !== null && (
                    <DeltaBadge value={delta.abs} percent={delta.pct} context="versus last month" />
                  )}
                  <StaleBadge capturedAt={total.capturedAt} stale={total.stale} />
                </div>
              </>
            )}
          </div>

          {/* Account strip. Revolut opens onto its sub-accounts; each visible
              hand-tracked account is its own row (an empty Teable cell reads as
              0), and a hidden one simply gets no row while still counting in the
              total above. */}
          <div className="hairline-t lg:col-start-1 lg:rounded-md lg:border lg:border-border lg:bg-surface">
            {managed.map((account) =>
              account.key === "revolut_total" ? (
                <AccountRow
                  key={account.key}
                  name={account.label}
                  value={account.balance}
                  capturedAt={account.capturedAt}
                  stale={account.stale}
                  sparkline={spark(account)}
                >
                  {revolutSubs.map((sub) => (
                    <AccountRow
                      key={sub.key}
                      nested
                      name={sub.label}
                      value={sub.balance}
                      capturedAt={sub.capturedAt}
                      stale={sub.stale}
                    />
                  ))}
                </AccountRow>
              ) : (
                <AccountRow
                  key={account.key}
                  name={account.label}
                  value={account.balance}
                  capturedAt={account.capturedAt}
                  stale={account.stale}
                  sparkline={spark(account)}
                />
              ),
            )}

            {visibleHandTracked.map((account) => (
              <AccountRow
                key={account.key}
                name={account.label}
                value={account.balance}
                capturedAt={account.capturedAt}
                stale={account.stale}
                sparkline={spark(account)}
              />
            ))}
          </div>
        </section>

        <section className="lg:col-start-2 lg:row-start-1 lg:row-end-4">
          {/* Vacation tile — payslip-authoritative residuals, shown in days. */}
          <div className="mt-6 flex items-center gap-4 px-4 lg:mt-0 lg:rounded-md lg:border lg:border-border lg:bg-surface lg:p-4">
            <ProgressRing
              value={remainingDays ?? 0}
              max={ringMax > 0 ? ringMax : 1}
              label="Leave remaining this year"
            >
              <span className="text-caption">{formatNumber(remainingDays)}</span>
            </ProgressRing>
            <div className="min-w-0">
              <div className="text-caption tracking-wide text-fg-muted uppercase">Ferie + ROL</div>
              <div className="num text-display-sm text-fg">
                {remainingDays === null ? "—" : formatDays(remainingDays)}
              </div>
              <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                <span className="num text-caption text-fg-muted">
                  {formatNumber(ferie.takenDaysYtd)} d taken in {ferie.year}
                </span>
                <StaleBadge
                  capturedAt={ferie.latest?.verifiedAt ?? null}
                  stale={ferie.latest === null}
                />
              </div>
            </div>
          </div>

          <div className="mt-6 grid gap-3 px-4 sm:grid-cols-2 lg:mt-6 lg:grid-cols-1 lg:px-0">
            <NavCard href="/finance" title="Finance" detail="Wealth, funds, vacation fund" />
            <NavCard href="/work" title="Work" detail="Leave, salary, payslips" />
          </div>
        </section>
      </div>
    </main>
  );
}
