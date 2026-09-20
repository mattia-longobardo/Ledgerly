import type { Metadata, Route } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { pocketsView, type PocketView } from "@/modules/pockets/queries";
import {
  type DialogContext,
  PocketActions,
  type PocketSummary,
  RestorePocket,
} from "@/modules/pockets/ui/pocket-actions";
import { percentOf } from "@/modules/budgets/rules";
import { requireSession } from "@/platform/auth/session";
import { addMonths, monthKey, today } from "@/platform/dates";
import {
  formatAmountInput,
  formatDate,
  formatMoney,
  formatWholePercent,
  NULL_DISPLAY,
} from "@/platform/format";
import { Badge } from "@/ui/badge";
import { Card, CardHeader } from "@/ui/card";
import { MiniBars } from "@/ui/chart";
import { cn } from "@/ui/cn";
import { KpiTile } from "@/ui/kpi-tile";
import { ProgressBar } from "@/ui/progress-bar";
import { Page } from "@/ui/shell/page";
import { EmptyState } from "@/ui/states";
import { Table, TBody, Td, Th, THead, Tr } from "@/ui/table";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("pockets"))("title") };
}

/** Pockets (spec §7.4): the list on the left, the selected pocket (`?pocket=`) on the right. */
export default async function PocketsPage({ searchParams }: PageProps<"/pockets">) {
  const ctx = await requireSession();
  const t = await getTranslations("pockets");
  const query = await searchParams;
  const view = await pocketsView(ctx);
  const todayOn = today(ctx.timeZone);
  const thisMonth = monthKey(todayOn);
  const money = (cents: bigint | null, decimals = true) => formatMoney(cents, ctx.numberFormat, { decimals });

  const summary = (item: PocketView): PocketSummary => ({
    id: item.pocket.id,
    name: item.pocket.name,
    state: item.pocket.state,
    backingAccountId: item.pocket.backingAccountId,
    accountName: item.accountName,
    balanceCents: item.balanceCents,
    freeCents: item.pocket.backingAccountId
      ? (view.freeByAccount[item.pocket.backingAccountId] ?? null)
      : null,
    targetInput: formatAmountInput(item.pocket.targetCents, ctx.numberFormat),
    monthlyInput: formatAmountInput(item.pocket.monthlyCents, ctx.numberFormat),
    startMonth: item.pocket.startMonth,
  });
  const context: DialogContext = {
    accounts: view.accounts,
    numberFormat: ctx.numberFormat,
    today: todayOn,
    thisMonth,
  };
  const selected = view.pockets.find((item) => item.pocket.id === query.pocket) ?? view.pockets[0] ?? null;
  const selectedSummary = selected ? summary(selected) : null;

  const archived =
    view.archived.length > 0 ? (
      <details className="text-sm">
        <summary className="cursor-pointer text-muted">
          {t("archived.count", { count: view.archived.length })}
        </summary>
        <ul className="mt-2 flex flex-col gap-1">
          {view.archived.map((pocket) => (
            <li key={pocket.id} className="flex items-center justify-between gap-2">
              <span>{pocket.name}</span>
              <RestorePocket id={pocket.id} label={t("actions.restore")} toast={t("toasts.restored")} />
            </li>
          ))}
        </ul>
      </details>
    ) : null;

  if (!selected || !selectedSummary) {
    return (
      <Page title={t("title")} actions={<PocketActions place="topbar" pocket={null} context={context} />}>
        <h1 className="text-title font-semibold tracking-[-0.02em] max-md:sr-only">{t("title")}</h1>
        <EmptyState
          title={t("empty.title")}
          description={t("empty.description")}
          actions={<PocketActions place="empty" pocket={null} context={context} />}
        />
        {archived}
      </Page>
    );
  }

  const pocket = selected.pocket;
  const target = pocket.targetCents;
  const funded = target === null ? 0 : percentOf(selected.balanceCents, target);
  const monthLabel = (month: string) => formatDate(month, "monthShort", ctx.locale);

  return (
    <Page
      title={t("title")}
      actions={<PocketActions place="topbar" pocket={selectedSummary} context={context} />}
    >
      <div className="flex flex-col gap-0.5">
        <h1 className="text-title font-semibold tracking-[-0.02em] max-md:sr-only">{t("title")}</h1>
        <p className="text-muted">{t("subtitle")}</p>
      </div>

      <div className="grid grid-cols-2 gap-4 @4xl:grid-cols-4">
        <KpiTile
          label={t("kpis.earmarked")}
          value={money(view.earmarkedCents)}
          note={t("kpis.count", { count: view.pockets.length })}
        />
        <KpiTile
          label={t("kpis.backing")}
          value={money(view.backingCents)}
          note={view.backingNames.length > 0 ? view.backingNames.join(" · ") : t("kpis.noBacking")}
        />
        <KpiTile
          label={t("kpis.free")}
          value={money(view.freeCents)}
          valueTone={view.freeCents !== null && view.freeCents < 0n ? "neg" : "pos"}
          note={t("kpis.freeNote")}
        />
        <KpiTile
          label={t("kpis.monthly")}
          value={money(view.monthlyCents, false)}
          note={t("kpis.nextAccrual", { date: formatDate(view.nextAccrual, "dayMonth", ctx.locale) })}
        />
      </div>

      <div className="grid items-start gap-4 @4xl:grid-cols-[minmax(0,4fr)_minmax(0,8fr)]">
        <nav aria-label={t("list.label")} className="flex flex-col gap-2">
          {view.pockets.map((item) => {
            const current = item.pocket.id === pocket.id;
            const itemTarget = item.pocket.targetCents;
            const percent = itemTarget === null ? null : percentOf(item.balanceCents, itemTarget);
            return (
              <Link
                key={item.pocket.id}
                href={`/pockets?pocket=${item.pocket.id}` as Route}
                aria-current={current ? "true" : undefined}
                data-testid="pocket-card"
                className={cn(
                  "focus-ring flex flex-col gap-2 rounded-card border bg-card p-3 hover:bg-hover",
                  current ? "border-accent ring-2 ring-soft" : "border-border",
                )}
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="truncate font-semibold">{item.pocket.name}</span>
                  <span className="flex items-center gap-1.5 text-sm text-muted tabular-nums">
                    {item.pocket.state === "paused" && <Badge tone="neutral">{t("list.paused")}</Badge>}
                    {percent === null ? t("list.openEnded") : formatWholePercent(percent, ctx.numberFormat)}
                  </span>
                </span>
                <ProgressBar
                  value={percent === null ? 0 : percent / 100}
                  dashed={percent === null}
                  label={item.pocket.name}
                />
                <span className="flex items-center justify-between gap-2 text-sm tabular-nums">
                  <span>
                    <span className="font-medium">{money(item.balanceCents)}</span>{" "}
                    <span className="text-muted">
                      {itemTarget === null
                        ? t("list.noTarget")
                        : t("list.ofTarget", { target: money(itemTarget, false) })}
                    </span>
                  </span>
                  {item.pocket.monthlyCents !== null && (
                    <span className="text-muted">
                      {t("list.perMonth", { amount: money(item.pocket.monthlyCents, false) })}
                    </span>
                  )}
                </span>
              </Link>
            );
          })}
          <PocketActions place="new" pocket={null} context={context} />
          {archived}
        </nav>

        <Card className="flex flex-col gap-4" data-testid="pocket-detail">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex min-w-0 flex-col gap-1">
              <p className="text-sm text-muted">
                {pocket.name} ·{" "}
                {selected.accountName
                  ? t("detail.onAccount", { account: selected.accountName })
                  : t("detail.standalone")}{" "}
                · {t("detail.since", { month: formatDate(pocket.startMonth, "monthYear", ctx.locale) })}
              </p>
              <p className="text-hero font-semibold tracking-[-0.02em] tabular-nums">
                {money(selected.balanceCents)}
              </p>
            </div>
            <div className="flex flex-col items-end gap-0.5 text-right">
              <span className="text-sm text-muted">
                {target === null
                  ? t("detail.accruedSince", {
                      month: formatDate(pocket.startMonth, "monthYear", ctx.locale),
                    })
                  : t("detail.target")}
              </span>
              <span className="text-lg font-semibold tabular-nums">
                {money(target === null ? selected.accruedCents : target, target === null)}
              </span>
            </div>
          </div>

          {pocket.state === "paused" && <p className="text-sm text-warn">{t("detail.paused")}</p>}

          {target === null ? (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-card border border-dashed border-border2 p-3 text-sm text-muted">
              <span>{t("detail.openEnded")}</span>
            </div>
          ) : (
            <div className="flex flex-col gap-1.5">
              <ProgressBar
                value={funded / 100}
                label={t("detail.funded", { percent: formatWholePercent(funded, ctx.numberFormat) })}
              />
              <div className="flex flex-wrap justify-between gap-2 text-sm tabular-nums">
                <span>{t("detail.funded", { percent: formatWholePercent(funded, ctx.numberFormat) })}</span>
                <span className="text-muted">
                  {selected.eta === 0
                    ? t("detail.reached")
                    : `${t("detail.toGo", { amount: money(target - selected.balanceCents) })} · ${
                        selected.eta === null
                          ? t("detail.noEta")
                          : t("detail.eta", {
                              months: selected.eta,
                              month: formatDate(addMonths(thisMonth, selected.eta), "monthYear", ctx.locale),
                            })
                      }`}
                </span>
              </div>
            </div>
          )}

          <dl className="grid grid-cols-3 gap-3 max-sm:grid-cols-1">
            <div className="flex flex-col gap-0.5">
              <dt className="text-sm text-muted">{t("detail.monthly")}</dt>
              <dd className="font-semibold tabular-nums">
                {pocket.monthlyCents === null ? t("detail.manual") : money(pocket.monthlyCents)}
              </dd>
            </div>
            <div className="flex flex-col gap-0.5">
              <dt className="text-sm text-muted">{t("detail.withdrawn")}</dt>
              <dd className={cn("font-semibold tabular-nums", selected.withdrawnCents < 0n && "text-neg")}>
                {selected.withdrawnCents === 0n ? NULL_DISPLAY : money(selected.withdrawnCents)}
              </dd>
            </div>
            <div className="flex flex-col gap-0.5">
              <dt className="text-sm text-muted">{t("detail.interest")}</dt>
              <dd
                className="font-semibold tabular-nums"
                title={
                  selected.interestReason === "standalone"
                    ? t("detail.interestStandalone")
                    : t("detail.interestUnknown")
                }
              >
                {money(selected.interestCents)}
              </dd>
              <dd className="text-xs text-faint">
                {selected.interestReason === "standalone"
                  ? t("detail.interestStandalone")
                  : t("detail.interestUnknown")}
              </dd>
            </div>
          </dl>

          <PocketActions place="detail" pocket={selectedSummary} context={context} />
        </Card>
      </div>

      <div className="grid items-start gap-4 @4xl:grid-cols-2">
        <Card padded={false}>
          <CardHeader
            title={t("chart.title")}
            actions={
              <span className="text-sm text-muted">
                {target === null ? t("chart.noTarget") : t("chart.topIsTarget")}
              </span>
            }
          />
          <div className="px-4 pb-4">
            <MiniBars
              values={selected.history.map((value) => (value === null ? null : Number(value)))}
              labels={view.months.map(
                (month, index) => `${monthLabel(month)} · ${money(selected.history[index])}`,
              )}
              xLabels={view.months.map((month) => formatDate(month, "month", ctx.locale))}
              target={target === null ? null : Number(target)}
              summary={t("chart.summary", { name: pocket.name, value: money(selected.balanceCents) })}
            />
          </div>
        </Card>

        <Card padded={false}>
          <CardHeader
            title={t("withdrawals.title")}
            actions={
              <span className="text-sm text-muted">
                {t("withdrawals.count", { count: selected.withdrawals.length })}
              </span>
            }
          />
          {selected.withdrawals.length === 0 ? (
            <p className="px-4 pb-4 text-sm text-muted">{t("withdrawals.empty")}</p>
          ) : (
            <Table>
              <THead>
                <Th>{t("withdrawals.date")}</Th>
                <Th>{t("withdrawals.purpose")}</Th>
                <Th align="right">{t("withdrawals.amount")}</Th>
              </THead>
              <TBody>
                {selected.withdrawals.map((movement) => (
                  <Tr key={movement.id}>
                    <Td muted>{formatDate(movement.on, "long", ctx.locale)}</Td>
                    <Td className="max-w-0 truncate font-medium">{movement.reason}</Td>
                    <Td align="right" className="text-neg">
                      {money(movement.amountCents)}
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          )}
        </Card>
      </div>
    </Page>
  );
}
