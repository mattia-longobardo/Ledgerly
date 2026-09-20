import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { accountsView } from "@/modules/accounts/queries";
import { BudgetsOverviewCard } from "@/modules/budgets/ui/overview-card";
import { pocketsTotal } from "@/modules/pockets/queries";
import { changeBetween } from "@/modules/accounts/ui/display";
import { NetWorthCard } from "@/modules/accounts/ui/net-worth-card";
import { requireSession } from "@/platform/auth/session";
import { monthKey, today } from "@/platform/dates";
import { formatDate, formatMoney, formatPercent, NULL_DISPLAY } from "@/platform/format";
import { ButtonLink } from "@/ui/button";
import { Card, CardHeader } from "@/ui/card";
import { cn } from "@/ui/cn";
import { KpiTile } from "@/ui/kpi-tile";
import { Page } from "@/ui/shell/page";
import { EmptyState } from "@/ui/states";
import { Table, TBody, Td, Th, THead, Tr } from "@/ui/table";
import { TONE_TEXT, toneOfSign } from "@/ui/tone";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("overview"))("title") };
}

export default async function OverviewPage({ searchParams }: PageProps<"/">) {
  const ctx = await requireSession();
  const t = await getTranslations("overview");
  const ta = await getTranslations("accounts");
  const now = new Date();
  const query = await searchParams;
  const thisMonth = monthKey(today(ctx.timeZone, now));
  // The hero, the KPIs and the table always speak of today; only the chart follows the preset or
  // the range the picker wrote (spec §7.1, F2.5), inside `NetWorthCard`.
  const view = await accountsView(ctx, { now });

  if (view.rows.length === 0) {
    return (
      <Page title={t("title")}>
        <h1 className="text-title font-semibold tracking-[-0.02em] max-md:sr-only">{t("title")}</h1>
        <EmptyState
          title={t("empty.title")}
          description={t("empty.description")}
          actions={
            <ButtonLink href="/accounts/new" variant="primary">
              {t("empty.cta")}
            </ButtonLink>
          }
        />
      </Page>
    );
  }

  const monthly = changeBetween(view.total, view.previousTotal);
  const yearStart = view.months.indexOf(`${thisMonth.slice(0, 4)}-01-01`);
  const ytd = changeBetween(view.total, yearStart > 0 ? view.netWorth[yearStart - 1].total : null);

  const pockets = await pocketsTotal(ctx);
  const tp = await getTranslations("pockets");
  const kpis = [
    { key: "cash", bucket: view.buckets.cash },
    { key: "savings", bucket: view.buckets.savings },
    { key: "investments", bucket: view.buckets.investments },
  ] as const;

  return (
    <Page
      title={t("title")}
      actions={
        <ButtonLink href="/accounts/new" variant="primary" size="sm">
          {ta("add")}
        </ButtonLink>
      }
    >
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-sm font-medium text-muted">
            {t("netWorth.on", { date: formatDate(today(ctx.timeZone, now), "long", ctx.locale) })}
          </h1>
          <p className="text-hero font-semibold tracking-[-0.02em]">
            {formatMoney(view.total, ctx.numberFormat)}
          </p>
          <p className="flex flex-wrap items-center gap-2 text-sm">
            <span className={cn("font-medium", TONE_TEXT[toneOfSign(monthly.cents)])}>
              {formatMoney(monthly.cents, ctx.numberFormat, { signed: true })}
              {monthly.fraction !== null &&
                ` (${formatPercent(monthly.fraction, ctx.numberFormat, { signed: true })})`}
            </span>
            <span className="text-muted">{t("netWorth.vsLastMonth")}</span>
            <span aria-hidden className="text-faint">
              ·
            </span>
            <span className="text-muted">
              {t("netWorth.ytd", {
                value: formatMoney(ytd.cents, ctx.numberFormat, { signed: true }),
              })}
            </span>
          </p>
        </div>
        <p className="text-sm text-muted">
          {view.lastSnapshot
            ? t("lastSnapshot", {
                date: formatDate(view.lastSnapshot.month, "monthYear", ctx.locale),
              })
            : t("noSnapshot")}
        </p>
      </div>

      {view.totalPartial && <p className="text-sm text-warn">{t("partial")}</p>}

      <div className="grid grid-cols-2 gap-4 @4xl:grid-cols-4">
        {kpis.map(({ key, bucket }) => (
          <KpiTile
            key={key}
            label={t(`kpis.${key}`)}
            value={formatMoney(bucket.total, ctx.numberFormat)}
            note={ta("countAccounts", { count: bucket.count })}
          />
        ))}
        {/* The fourth tile of the design, deferred by F1 until pockets existed (F3). */}
        <KpiTile
          label={tp("overview.label")}
          value={formatMoney(pockets.totalCents, ctx.numberFormat)}
          delta={tp("overview.perMonth", {
            amount: formatMoney(pockets.monthlyCents, ctx.numberFormat, { decimals: false }),
          })}
          deltaTone="pos"
          note={tp("kpis.count", { count: pockets.count })}
        />
      </div>

      {/* Past the wide threshold the chart and the accounts sit side by side (spec §8.2, F2.5). */}
      {/* `minmax(0,1fr)` also in one column: an auto track takes the widest child's min-content
          width — a table's — and the cards would then reach past the page (400 px). */}
      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-4 @wide:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
        <NetWorthCard ctx={ctx} query={query} path="/" now={now} />

        <Card padded={false}>
          <CardHeader
            title={ta("title")}
            actions={
              <Link
                href="/accounts"
                className="focus-ring inline-flex h-6 items-center rounded-[2px] text-accent hover:underline"
              >
                {t("manageAccounts")}
              </Link>
            }
          />
          <div className="overflow-x-auto max-md:hidden">
            <Table>
              <THead>
                <Th>{ta("columns.name")}</Th>
                <Th>{ta("columns.type")}</Th>
                <Th align="right">{ta("columns.balance")}</Th>
                <Th align="right">{ta("columns.monthlyChange")}</Th>
              </THead>
              <TBody>
                {view.rows.map((row) => {
                  const change = changeBetween(row.balance, row.previous);
                  return (
                    <Tr key={row.account.id}>
                      <Td>
                        <Link
                          href={`/accounts/${row.account.id}`}
                          className="focus-ring inline-flex h-6 items-center rounded-[2px] font-medium hover:underline"
                        >
                          {row.account.name}
                        </Link>
                      </Td>
                      <Td muted>{ta(`types.${row.account.type}`)}</Td>
                      <Td align="right">{formatMoney(row.balance, ctx.numberFormat)}</Td>
                      <Td align="right" className={TONE_TEXT[toneOfSign(change.cents)]}>
                        {change.cents === null
                          ? NULL_DISPLAY
                          : formatMoney(change.cents, ctx.numberFormat, { signed: true })}
                      </Td>
                    </Tr>
                  );
                })}
              </TBody>
            </Table>
          </div>
          {/* A phone gets the same rows as a list: a four-column table cannot fit 400 px. */}
          <ul className="flex flex-col md:hidden">
            {view.rows.map((row) => {
              const change = changeBetween(row.balance, row.previous);
              return (
                <li
                  key={row.account.id}
                  data-testid="overview-account-item"
                  className="border-b border-border last:border-0"
                >
                  <Link
                    href={`/accounts/${row.account.id}`}
                    className="flex items-center justify-between gap-2 px-4 py-3"
                  >
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate font-medium">{row.account.name}</span>
                      <span className="text-sm text-muted">{ta(`types.${row.account.type}`)}</span>
                    </span>
                    <span className="flex flex-col items-end tabular-nums">
                      <span className="font-semibold">{formatMoney(row.balance, ctx.numberFormat)}</span>
                      <span className={cn("text-sm", TONE_TEXT[toneOfSign(change.cents)])}>
                        {change.cents === null
                          ? NULL_DISPLAY
                          : formatMoney(change.cents, ctx.numberFormat, { signed: true })}
                      </span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </Card>
      </div>

      {/* The card spans the page's whole column: it lays its budgets out in one or two columns
          itself, by its own width (spec §8.2). */}
      <BudgetsOverviewCard ctx={ctx} month={thisMonth} />
    </Page>
  );
}
