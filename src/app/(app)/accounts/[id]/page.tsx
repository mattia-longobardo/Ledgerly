import type { Metadata } from "next";
import type { Route } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { accountsView, listBalanceEntries } from "@/modules/accounts/queries";
import {
  asNumbers,
  axisLabels,
  changeBetween,
  colorFor,
  monthLabels,
  shareOf,
  since,
} from "@/modules/accounts/ui/display";
import { BalanceEntries, type EntryRow } from "@/modules/accounts/ui/balance-entries";
import { AccountSettingsForm } from "@/modules/accounts/ui/settings-form";
import { requireSession } from "@/platform/auth/session";
import { getAccount } from "@/modules/accounts/queries";
import { today } from "@/platform/dates";
import { centsToDecimal } from "@/platform/money";
import { formatDate, formatMoney, formatPercent, NULL_DISPLAY } from "@/platform/format";
import { Badge } from "@/ui/badge";
import { Card } from "@/ui/card";
import { AreaLine } from "@/ui/chart";
import { KpiTile } from "@/ui/kpi-tile";
import { Page } from "@/ui/shell/page";
import { EmptyState } from "@/ui/states";
import { TabLinks } from "@/ui/tab-links";
import { Table, TBody, Td, Th, THead, Tr } from "@/ui/table";
import { TONE_TEXT, toneOfSign } from "@/ui/tone";

const TABS = ["overview", "transactions", "entries", "settings"] as const;
type Tab = (typeof TABS)[number];

export async function generateMetadata({ params }: PageProps<"/accounts/[id]">): Promise<Metadata> {
  const ctx = await requireSession();
  const account = await getAccount(ctx, (await params).id);
  return { title: account?.name ?? (await getTranslations("accounts"))("title") };
}

export default async function AccountDetailPage({ params, searchParams }: PageProps<"/accounts/[id]">) {
  const ctx = await requireSession();
  const t = await getTranslations("accounts");
  const td = await getTranslations("accounts.detail");
  const { id } = await params;
  const now = new Date();

  const view = await accountsView(ctx, { now });
  const index = view.rows.findIndex((row) => row.account.id === id);
  if (index < 0) notFound();
  const row = view.rows[index];
  const account = row.account;

  const requested = (await searchParams).tab;
  const tab: Tab = TABS.includes(requested as Tab) ? (requested as Tab) : "overview";
  const tabs = TABS.map((key) => ({
    href: (key === "overview" ? `/accounts/${id}` : `/accounts/${id}?tab=${key}`) as Route,
    label: td(`tabs.${key}`),
    active: key === tab,
  }));

  const change = changeBetween(row.balance, row.previous);
  const yoy = changeBetween(row.balance, row.series.at(-13) ?? null);
  const share = shareOf(row.balance, view.total);
  const synced = since(account.lastSyncedAt, now);
  const color = colorFor(account, index);

  return (
    <Page title={account.name} parent={{ href: "/accounts", label: t("title") }}>
      <header className="flex flex-col gap-1">
        <p className="flex flex-wrap items-center gap-2 text-sm text-muted">
          <span aria-hidden className="size-2 rounded-full" style={{ background: color }} />
          <span>{t(`types.${account.type}`)}</span>
          <span aria-hidden>·</span>
          <span>
            {account.origin === "manual"
              ? t("origins.manual")
              : t("origins.syncedWith", { provider: account.provider ?? "" })}
          </span>
          {account.origin === "synced" && (
            <>
              <span aria-hidden>·</span>
              <span>
                {synced.unit === "never"
                  ? t("synced.never")
                  : t(`synced.${synced.unit}`, { count: synced.count })}
              </span>
            </>
          )}
          {account.state !== "active" && <Badge tone="warn">{t(`states.${account.state}`)}</Badge>}
          {row.stale && <Badge tone="warn">{t("stale")}</Badge>}
        </p>
        <h1 className="text-title font-semibold tracking-[-0.02em]">{account.name}</h1>
        <p className="flex flex-wrap items-baseline gap-3">
          <span className="text-hero-sm font-semibold tracking-[-0.02em]">
            {formatMoney(row.balance, ctx.numberFormat)}
          </span>
          <span className={`text-sm font-medium ${TONE_TEXT[toneOfSign(change.cents)]}`}>
            {change.cents === null
              ? NULL_DISPLAY
              : formatMoney(change.cents, ctx.numberFormat, { signed: true })}{" "}
            {td("thisMonth")}
          </span>
          <span className="text-sm text-muted">
            {td("shareOfNetWorth", { value: formatPercent(share, ctx.numberFormat) })}
          </span>
        </p>
      </header>

      <TabLinks label={td("tabs.label")} tabs={tabs} />

      {tab === "overview" && (
        <OverviewTab ctx={ctx} row={row} months={view.months} yoy={yoy} share={share} color={color} />
      )}

      {tab === "transactions" && (
        <EmptyState title={td("transactions.title")} description={td("transactions.description")} />
      )}

      {tab === "entries" && (
        <BalanceEntries
          accountId={id}
          today={today(ctx.timeZone, now)}
          synced={account.origin === "synced"}
          entries={await entryRows(ctx, id)}
        />
      )}

      {tab === "settings" && (
        <AccountSettingsForm
          today={today(ctx.timeZone, now)}
          account={{
            id: account.id,
            name: account.name,
            type: account.type,
            currency: account.currency,
            provider: account.provider,
            origin: account.origin,
            state: account.state,
            color: account.color,
            reference: account.reference,
            purpose: account.purpose,
            openedOn: account.openedOn,
            notes: account.notes,
            inNetWorth: account.inNetWorth,
            inSnapshot: account.inSnapshot,
            countsAsLiquid: account.countsAsLiquid,
            lowBalance: account.lowBalanceCents === null ? "" : centsToDecimal(account.lowBalanceCents),
            staleAfterHours: account.staleAfterHours,
            reminder: account.reminder,
            betweenEntries: account.betweenEntries,
          }}
        />
      )}
    </Page>
  );
}

type Ctx = Awaited<ReturnType<typeof requireSession>>;
type Row = Awaited<ReturnType<typeof accountsView>>["rows"][number];

async function OverviewTab({
  ctx,
  row,
  months,
  yoy,
  share,
  color,
}: {
  ctx: Ctx;
  row: Row;
  months: string[];
  yoy: ReturnType<typeof changeBetween>;
  share: number | null;
  color: string;
}) {
  const t = await getTranslations("accounts.detail");
  const ta = await getTranslations("accounts");
  const monthRows = months
    .map((month, index) => ({
      month,
      value: row.series[index],
      change: changeBetween(row.series[index], index > 0 ? row.series[index - 1] : null),
    }))
    .filter((entry) => entry.value !== null)
    .reverse();

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiTile
          label={t("kpis.balance")}
          value={formatMoney(row.balance, ctx.numberFormat)}
          note={ta(`types.${row.account.type}`)}
        />
        <KpiTile
          label={t("kpis.yoy")}
          value={formatPercent(yoy.fraction, ctx.numberFormat, { signed: true })}
          valueTone={toneOfSign(yoy.cents)}
        />
        <KpiTile
          label={t("kpis.share")}
          value={formatPercent(share, ctx.numberFormat)}
          note={t("kpis.shareNote")}
        />
        <KpiTile
          label={t("kpis.opened")}
          value={row.account.openedOn ? formatDate(row.account.openedOn, "long", ctx.locale) : NULL_DISPLAY}
        />
      </div>

      <Card padded={false} className="flex flex-col gap-3 p-4">
        <h2 className="text-lg font-semibold">{t("chart.title", { count: months.length })}</h2>
        <AreaLine
          values={asNumbers(row.series)}
          yLabels={axisLabels(row.series, ctx.numberFormat)}
          xLabels={monthLabels(months, ctx.locale)}
          summary={t("chart.summary", {
            name: row.account.name,
            value: formatMoney(row.balance, ctx.numberFormat),
          })}
        />
      </Card>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Card padded={false} className="flex flex-col">
          <h2 className="px-4 pt-3.5 pb-2.5 text-lg font-semibold">{t("monthEnd.title")}</h2>
          {monthRows.length === 0 ? (
            <p className="px-4 pb-4 text-muted">{t("monthEnd.empty")}</p>
          ) : (
            <Table>
              <THead>
                <Th>{t("monthEnd.month")}</Th>
                <Th align="right">{t("monthEnd.balance")}</Th>
                <Th align="right">{t("monthEnd.change")}</Th>
                <Th align="right">{t("monthEnd.percent")}</Th>
              </THead>
              <TBody>
                {monthRows.map((entry) => (
                  <Tr key={entry.month}>
                    <Td>{formatDate(entry.month, "monthYear", ctx.locale)}</Td>
                    <Td align="right">{formatMoney(entry.value, ctx.numberFormat)}</Td>
                    <Td align="right" className={TONE_TEXT[toneOfSign(entry.change.cents)]}>
                      {entry.change.cents === null
                        ? NULL_DISPLAY
                        : formatMoney(entry.change.cents, ctx.numberFormat, { signed: true })}
                    </Td>
                    <Td align="right" className={TONE_TEXT[toneOfSign(entry.change.cents)]}>
                      {formatPercent(entry.change.fraction, ctx.numberFormat, { signed: true })}
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          )}
        </Card>

        <Card className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">{t("details.title")}</h2>
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
            <dt className="text-muted">{t("details.reference")}</dt>
            <dd className="truncate font-mono">{row.account.reference ?? NULL_DISPLAY}</dd>
            <dt className="text-muted">{t("details.purpose")}</dt>
            <dd className="truncate">{row.account.purpose ?? NULL_DISPLAY}</dd>
            <dt className="text-muted">{t("details.currency")}</dt>
            <dd>{row.account.currency}</dd>
            <dt className="text-muted">{t("details.source")}</dt>
            <dd>
              {row.account.origin === "manual"
                ? ta("origins.manual")
                : ta("origins.syncedWith", { provider: row.account.provider ?? "" })}
            </dd>
            <dt className="text-muted">{t("details.betweenEntries")}</dt>
            <dd>{t(`details.trends.${row.account.betweenEntries}`)}</dd>
            <dt className="text-muted">{t("details.inNetWorth")}</dt>
            <dd>{row.account.inNetWorth ? t("details.yes") : t("details.no")}</dd>
            <dt className="text-muted">{t("details.inSnapshot")}</dt>
            <dd>{row.account.inSnapshot ? t("details.yes") : t("details.no")}</dd>
          </dl>
          <span aria-hidden className="h-1 rounded-full" style={{ background: color }} />
        </Card>
      </div>
    </div>
  );
}

async function entryRows(ctx: Ctx, accountId: string): Promise<EntryRow[]> {
  const entries = await listBalanceEntries(ctx, accountId);
  return entries.map((entry, index) => {
    const earlier = entries[index + 1]?.balanceCents ?? null;
    const change = changeBetween(entry.balanceCents, earlier);
    return {
      id: entry.id,
      on: entry.on,
      onLabel: formatDate(entry.on, "long", ctx.locale),
      balance: formatMoney(entry.balanceCents, ctx.numberFormat),
      change:
        change.cents === null ? NULL_DISPLAY : formatMoney(change.cents, ctx.numberFormat, { signed: true }),
      changeSign: change.cents === null ? 0 : Number(change.cents),
      note: entry.note,
      source: entry.source,
    };
  });
}
