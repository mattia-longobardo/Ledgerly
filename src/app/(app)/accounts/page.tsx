import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { accountsView, listAccounts } from "@/modules/accounts/queries";
import { asNumbers, changeBetween, colorFor, shareOf, since } from "@/modules/accounts/ui/display";
import { LinkTabs, PeriodStepper, ToggleLink } from "@/modules/accounts/ui/controls";
import { NetWorthCard } from "@/modules/accounts/ui/net-worth-card";
import { type Grain, periodEnd } from "@/modules/accounts/rules";
import { requireSession } from "@/platform/auth/session";
import { today } from "@/platform/dates";
import { formatDate, formatMoney, formatPercent, NULL_DISPLAY } from "@/platform/format";
import { ButtonLink } from "@/ui/button";
import { Badge } from "@/ui/badge";
import { Card } from "@/ui/card";
import { CompositionBar, Sparkline } from "@/ui/chart";
import { KpiTile } from "@/ui/kpi-tile";
import { Page } from "@/ui/shell/page";
import { EmptyState } from "@/ui/states";
import { Table, TBody, Td, Th, THead, TotalRow, Tr } from "@/ui/table";
import { TONE_TEXT, toneOfSign } from "@/ui/tone";
import { withParams } from "@/ui/url";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("accounts"))("title") };
}

export default async function AccountsPage({ searchParams }: PageProps<"/accounts">) {
  const ctx = await requireSession();
  const t = await getTranslations("accounts");
  const now = new Date();

  const query = await searchParams;
  const grain: Grain = query.grain === "year" ? "year" : "month";
  const offset = Math.max(0, Number(query.off ?? 0) || 0);
  // An archived account is off the list until it is asked for, and it stays out of the totals even
  // then: the same page must not give two different net worths depending on a checkbox.
  const showArchived = query.archived === "1";
  const params = {
    grain: grain === "month" ? undefined : grain,
    off: offset ? String(offset) : undefined,
    archived: showArchived ? "1" : undefined,
  };
  const end = periodEnd(grain, offset, today(ctx.timeZone, now));
  const periodShort = grain === "year" ? end.slice(0, 4) : formatDate(end, "monthShort", ctx.locale);
  const periodLong =
    (grain === "year" ? end.slice(0, 4) : formatDate(end, "monthYear", ctx.locale)) +
    (offset === 0 ? ` · ${grain === "year" ? t("period.ytd") : t("period.today")}` : "");

  const view = await accountsView(ctx, { now, through: end, includeArchived: showArchived });

  const add = (
    <ButtonLink href="/accounts/new" variant="primary" size="sm">
      {t("add")}
    </ButtonLink>
  );

  if (view.rows.length === 0) {
    // Somebody who archived their last account has not stopped having accounts, and the empty
    // state must not tell them they have: without this, archiving the only one left them looking
    // at "No accounts yet" with no checkbox anywhere to find it again.
    const archived = showArchived
      ? []
      : (await listAccounts(ctx, { includeArchived: true })).filter(
          (account) => account.state === "archived",
        );
    return (
      <Page title={t("title")} actions={add}>
        <h1 className="text-title font-semibold tracking-[-0.02em] max-md:sr-only">{t("title")}</h1>
        <EmptyState
          title={t("empty.title")}
          description={
            archived.length > 0 ? t("empty.archived", { count: archived.length }) : t("empty.description")
          }
          actions={
            <>
              <ButtonLink href="/accounts/new" variant="primary">
                {t("add")}
              </ButtonLink>
              {archived.length > 0 && (
                <ButtonLink href={withParams("/accounts", {}, { archived: "1" })}>
                  {t("showArchived")}
                </ButtonLink>
              )}
            </>
          }
        />
      </Page>
    );
  }

  const rows = view.rows.map((row, index) => {
    const yearAgo = row.series.at(-13) ?? null;
    return {
      ...row,
      color: colorFor(row.account, index),
      change: changeBetween(row.balance, row.previous),
      yoy: changeBetween(row.balance, yearAgo),
      // No share for an archived account: the total it would be a share of leaves it out, and a
      // percentage of a number you are not part of is a wrong number, not a missing one.
      share: row.account.state === "archived" ? null : shareOf(row.balance, view.total),
      synced: since(row.account.lastSyncedAt, now),
    };
  });

  // The headline counts what the headline's total is made of, so the two never disagree.
  const liveCount = view.rows.filter((row) => row.account.state !== "archived").length;

  const kpis = [
    {
      key: "total" as const,
      total: view.total,
      count: liveCount,
    },
    { key: "cash" as const, total: view.buckets.cash.total, count: view.buckets.cash.count },
    { key: "savings" as const, total: view.buckets.savings.total, count: view.buckets.savings.count },
    {
      key: "investments" as const,
      total: view.buckets.investments.total,
      count: view.buckets.investments.count,
    },
  ];
  const totalChange = changeBetween(view.total, view.previousTotal);

  return (
    <Page title={t("title")} actions={add}>
      <div className="flex flex-wrap items-baseline gap-3">
        <h1 className="text-title font-semibold tracking-[-0.02em]">{t("title")}</h1>
        <p data-testid="accounts-summary" className="text-muted">
          {t("summary", {
            total: formatMoney(view.total, ctx.numberFormat),
            count: liveCount,
          })}
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <LinkTabs
          label={t("period.grain")}
          path="/accounts"
          params={params}
          name="grain"
          current={grain}
          options={[
            { value: "month", label: t("period.grains.month") },
            { value: "year", label: t("period.grains.year") },
          ]}
        />
        <div className="flex flex-wrap items-center gap-2">
          <ToggleLink
            label={t("showArchived")}
            path="/accounts"
            params={params}
            name="archived"
            on={showArchived}
          />
        </div>
        <PeriodStepper
          label={t("period.label")}
          path="/accounts"
          params={params}
          offset={offset}
          periodLabel={periodLong}
          previousLabel={t("period.previous")}
          nextLabel={t("period.next")}
          latestLabel={t("period.latest")}
        />
      </div>

      <div className="grid grid-cols-2 gap-4 @4xl:grid-cols-4">
        {kpis.map((kpi) => (
          <KpiTile
            key={kpi.key}
            label={t(`kpis.${kpi.key}`)}
            value={formatMoney(kpi.total, ctx.numberFormat)}
            note={t("countAccounts", { count: kpi.count })}
          />
        ))}
      </div>

      <Card padded={false}>
        {/* Eight columns do not fit a phone at any font size: below `md` the same accounts are a
            list, carrying every figure the table carries (plan F9 §3.3). */}
        <div className="overflow-x-auto max-md:hidden">
          <Table>
            <THead>
              <Th>{t("columns.name")}</Th>
              <Th>{t("columns.type")}</Th>
              <Th align="right">{t("columns.balanceOn", { period: periodShort })}</Th>
              <Th align="right">{t("columns.monthlyChange")}</Th>
              <Th align="right">{t("columns.yoy")}</Th>
              <Th align="right">{t("columns.share")}</Th>
              <Th>{t("columns.lastSynced")}</Th>
              <Th>{t("columns.history")}</Th>
            </THead>
            <TBody>
              {rows.map((row) => (
                <Tr key={row.account.id}>
                  <Td>
                    <div className="flex items-center gap-2">
                      <span
                        aria-hidden
                        className="size-2 shrink-0 rounded-full"
                        style={{ background: row.color }}
                      />
                      <Link
                        href={`/accounts/${row.account.id}`}
                        className="focus-ring inline-flex min-h-6 items-center rounded-[2px] font-medium hover:underline"
                      >
                        {row.account.name}
                      </Link>
                      {row.account.state === "unavailable" && (
                        <Badge tone="warn">{t("states.unavailable")}</Badge>
                      )}
                      {row.account.state === "archived" && (
                        <Badge tone="neutral">{t("states.archived")}</Badge>
                      )}
                      {row.stale && <Badge tone="warn">{t("stale")}</Badge>}
                    </div>
                  </Td>
                  <Td muted>{t(`types.${row.account.type}`)}</Td>
                  <Td align="right">{formatMoney(row.balance, ctx.numberFormat)}</Td>
                  <Td align="right" className={TONE_TEXT[toneOfSign(row.change.cents)]}>
                    {row.change.cents === null
                      ? NULL_DISPLAY
                      : formatMoney(row.change.cents, ctx.numberFormat, { signed: true })}
                  </Td>
                  <Td align="right" className={TONE_TEXT[toneOfSign(row.yoy.cents)]}>
                    {formatPercent(row.yoy.fraction, ctx.numberFormat, { signed: true })}
                  </Td>
                  <Td align="right">{formatPercent(row.share, ctx.numberFormat)}</Td>
                  <Td muted>
                    {row.account.origin === "manual"
                      ? t("origins.manual")
                      : row.synced.unit === "never"
                        ? t("synced.never")
                        : t(`synced.${row.synced.unit}`, { count: row.synced.count })}
                  </Td>
                  <Td>
                    <Sparkline values={asNumbers(row.series)} tone={row.color} />
                  </Td>
                </Tr>
              ))}
              <TotalRow label={t("total")}>
                <Td />
                <Td align="right">{formatMoney(view.total, ctx.numberFormat)}</Td>
                <Td align="right" className={TONE_TEXT[toneOfSign(totalChange.cents)]}>
                  {totalChange.cents === null
                    ? NULL_DISPLAY
                    : formatMoney(totalChange.cents, ctx.numberFormat, { signed: true })}
                </Td>
                <Td />
                <Td align="right">{formatPercent(view.total === null ? null : 1, ctx.numberFormat)}</Td>
                <Td />
                <Td />
              </TotalRow>
            </TBody>
          </Table>
        </div>

        <ul className="flex flex-col md:hidden">
          {rows.map((row) => (
            <li
              key={row.account.id}
              className="flex flex-col gap-2 border-b border-border px-4 py-3 last:border-0"
            >
              <div className="flex items-start justify-between gap-2">
                <span className="flex min-w-0 items-center gap-2">
                  <span
                    aria-hidden
                    className="size-2 shrink-0 rounded-full"
                    style={{ background: row.color }}
                  />
                  <Link
                    href={`/accounts/${row.account.id}`}
                    className="focus-ring inline-flex min-h-6 items-center rounded-[2px] font-medium hover:underline"
                  >
                    {row.account.name}
                  </Link>
                </span>
                <span className="shrink-0 font-medium tabular-nums">
                  {formatMoney(row.balance, ctx.numberFormat)}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">
                <span>{t(`types.${row.account.type}`)}</span>
                <span aria-hidden>·</span>
                <span>
                  {row.account.origin === "manual"
                    ? t("origins.manual")
                    : row.synced.unit === "never"
                      ? t("synced.never")
                      : t(`synced.${row.synced.unit}`, { count: row.synced.count })}
                </span>
                {row.account.state === "unavailable" && <Badge tone="warn">{t("states.unavailable")}</Badge>}
                {row.account.state === "archived" && <Badge tone="neutral">{t("states.archived")}</Badge>}
                {row.stale && <Badge tone="warn">{t("stale")}</Badge>}
              </div>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm tabular-nums">
                <span className={TONE_TEXT[toneOfSign(row.change.cents)]}>
                  {t("columns.monthlyChange")}{" "}
                  {row.change.cents === null
                    ? NULL_DISPLAY
                    : formatMoney(row.change.cents, ctx.numberFormat, { signed: true })}
                </span>
                <span className={TONE_TEXT[toneOfSign(row.yoy.cents)]}>
                  {t("columns.yoy")} {formatPercent(row.yoy.fraction, ctx.numberFormat, { signed: true })}
                </span>
                <span className="text-muted">
                  {t("columns.share")} {formatPercent(row.share, ctx.numberFormat)}
                </span>
              </div>
              <Sparkline values={asNumbers(row.series)} tone={row.color} />
            </li>
          ))}
          <li className="flex items-center justify-between gap-2 px-4 py-3 font-medium">
            <span>{t("total")}</span>
            <span className="tabular-nums">{formatMoney(view.total, ctx.numberFormat)}</span>
          </li>
        </ul>
      </Card>

      {view.totalPartial && <p className="text-sm text-warn">{t("partial")}</p>}

      <div className="grid gap-4 @4xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        {/* Overview's chart, with its own range and grain (`chart=` here: `grain` is the table's). */}
        <NetWorthCard ctx={ctx} query={query} path="/accounts" carry={params} grainParam="chart" now={now} />

        <Card padded={false} className="flex flex-col gap-3 p-4">
          <h2 className="text-lg font-semibold">{t("composition.title")}</h2>
          <CompositionBar
            parts={rows.map((row) => ({
              label: row.account.name,
              share: row.share ?? 0,
              color: row.color,
            }))}
          />
          <ul className="flex flex-col gap-2 text-sm">
            {rows.map((row) => (
              <li key={row.account.id} className="flex items-center justify-between gap-3">
                <span className="flex min-w-0 items-center gap-1.5">
                  <span
                    aria-hidden
                    className="size-2 shrink-0 rounded-full"
                    style={{ background: row.color }}
                  />
                  <span className="truncate">{row.account.name}</span>
                </span>
                <span className="shrink-0 tabular-nums text-muted">
                  {formatPercent(row.share, ctx.numberFormat)}
                </span>
                <span className="shrink-0 tabular-nums">{formatMoney(row.balance, ctx.numberFormat)}</span>
              </li>
            ))}
          </ul>
          <dl className="grid grid-cols-2 gap-3 border-t border-border pt-3 text-sm">
            <div>
              <dt className="text-muted">{t("composition.liquid")}</dt>
              <dd className="font-medium tabular-nums">
                {formatMoney(view.buckets.cash.total, ctx.numberFormat)}
              </dd>
            </div>
            <div>
              <dt className="text-muted">{t("composition.invested")}</dt>
              <dd className="font-medium tabular-nums">
                {formatMoney(view.buckets.investments.total, ctx.numberFormat)}
              </dd>
            </div>
          </dl>
        </Card>
      </div>
    </Page>
  );
}
