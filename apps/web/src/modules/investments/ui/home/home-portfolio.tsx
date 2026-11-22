"use client";

// The one list of Investments (rewrite plan R5b, decisions B1, B2, Q2; 11-standardization.md §11.4): the
// chips «All · Stocks and crypto · Pension funds», the four KPIs of the chip, and the groups with their
// subtotal and their rows — services, accounts with value only and pension funds. Every figure is a
// field of `total` and `groups` of `GET /investments/home`: the screen adds nothing up.
import { useTranslations } from "next-intl";
import { Card, CardHeader } from "@ledgerly/ui/card";
import { cn } from "@ledgerly/ui/cn";
import { KpiTile } from "@ledgerly/ui/kpi-tile";
import { Link } from "@ledgerly/ui/router";
import { toneOfSign } from "@ledgerly/ui/tone";
import { withParams } from "@ledgerly/ui/url";
import { centsOf } from "../present";
import { CHIPS, type HomeContext } from "./home-view";

type Group = HomeContext["home"]["groups"][number];
type Row = Group["rows"][number];
type Kpis = HomeContext["home"]["total"];

/** The chips: links, so the choice is in the address with the period, and Back undoes it. */
function Chips({ context }: { context: HomeContext }) {
  const text = useTranslations("investments.portfolio");
  const { chip, section, kept } = context;
  return (
    <nav aria-label={text("chips")} className="flex flex-wrap gap-2">
      {CHIPS.map((one) => (
        <Link
          key={one}
          href={withParams(
            "/investments",
            { ...section.params, ...kept },
            { group: one === "all" ? undefined : one },
          )}
          aria-current={one === chip ? "page" : undefined}
          className={cn(
            "focus-ring inline-flex h-8 items-center rounded-full border px-3 text-sm font-medium",
            one === chip ? "border-fg bg-fg text-card" : "border-border text-muted hover:text-fg",
          )}
        >
          {text(`groups.${one}`)}
        </Link>
      ))}
    </nav>
  );
}

/** The four KPIs (Q2): value today, the money paid in, the gain and the return of the period. */
function KpiRow({ kpis, context }: { kpis: Kpis; context: HomeContext }) {
  const text = useTranslations("investments.portfolio");
  const { money, percent, name } = context;
  const rateNote =
    kpis.rateReason === "ok" || kpis.rateReason === "none" ? undefined : text(`rate.${kpis.rateReason}`);
  return (
    <div className="grid grid-cols-2 gap-4 @4xl:grid-cols-4">
      <KpiTile
        testId="portfolio-value"
        label={text("kpis.value")}
        value={money(kpis.value)}
        note={kpis.valuePartial ? text("kpis.partial") : undefined}
      />
      <KpiTile
        testId="portfolio-paid-in"
        label={text("kpis.paidIn")}
        value={money(kpis.paidIn)}
        note={name}
      />
      <KpiTile
        testId="portfolio-gain"
        label={text("kpis.gain")}
        value={money(kpis.gain, { signed: true })}
        valueTone={toneOfSign(centsOf(kpis.gain))}
        note={name}
      />
      <KpiTile
        testId="portfolio-rate"
        label={text("kpis.rate")}
        value={percent(kpis.rate)}
        valueTone={toneOfSign(kpis.rate ?? null)}
        note={rateNote ?? name}
      />
    </div>
  );
}

/** A row's page: a service's or a fund's in Investments; an account kept as a total has its own in Accounts. */
function rowHref(row: Row, context: HomeContext): string {
  const inInvestments =
    row.kind === "pension_fund" || context.home.services.some((one) => one.accountId === row.accountId);
  return inInvestments ? context.serviceHref(row.accountId) : `/accounts/${row.accountId}`;
}

function PortfolioRow({ row, context }: { row: Row; context: HomeContext }) {
  const text = useTranslations("investments.portfolio");
  const { money, home } = context;
  const own = row.currency !== home.currency && row.value !== null;
  return (
    <li
      data-testid="portfolio-row"
      className="flex items-center justify-between gap-3 border-b border-border px-4 py-2.5 last:border-0"
    >
      <span className="flex min-w-0 flex-col">
        {/* No prefetch: each row's page asks the server who holds the account (2-3 reads of `/api/v1`). */}
        <Link
          href={rowHref(row, context)}
          prefetch={false}
          className="focus-ring inline-flex min-h-6 min-w-0 items-center rounded-sm font-medium hover:underline"
        >
          <span className="truncate">{row.name}</span>
        </Link>
        <span className="text-sm text-muted">
          {text(`kinds.${row.kind}`)}
          {!row.inTotal && ` · ${text("notInTotal")}`}
        </span>
      </span>
      <span className="flex flex-col items-end tabular-nums">
        <span className="font-semibold">{money(row.displayValue)}</span>
        {own && <span className="text-sm text-muted">{money(row.value, { currency: row.currency })}</span>}
      </span>
    </li>
  );
}

/** A group: its name, its subtotal — the tile of Overview — and its rows. */
function GroupCard({ group, context }: { group: Group; context: HomeContext }) {
  const text = useTranslations("investments.portfolio");
  return (
    <Card padded={false} data-testid={`portfolio-group-${group.id}`}>
      <CardHeader
        title={text(`groups.${group.id}`)}
        actions={
          <span
            data-testid="group-subtotal"
            data-cents={String(centsOf(group.kpis.value) ?? "")}
            className="font-semibold tabular-nums"
          >
            {context.money(group.kpis.value)}
          </span>
        }
      />
      <ul>
        {group.rows.map((row) => (
          <PortfolioRow key={row.accountId} row={row} context={context} />
        ))}
      </ul>
    </Card>
  );
}

/** The chips, the KPIs of the chip, and its groups. */
export function HomePortfolio({ context }: { context: HomeContext }) {
  const { home, chip } = context;
  const groups = home.groups.filter((group) => chip === "all" || group.id === chip);
  const kpis = chip === "all" ? home.total : (groups[0]?.kpis ?? null);
  return (
    <section className="flex flex-col gap-4">
      <Chips context={context} />
      {kpis && <KpiRow kpis={kpis} context={context} />}
      {groups.map((group) => (
        <GroupCard key={group.id} group={group} context={context} />
      ))}
    </section>
  );
}
