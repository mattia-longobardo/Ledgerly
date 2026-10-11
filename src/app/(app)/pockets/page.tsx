import type { Metadata, Route } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { pocketsView } from "@/modules/pockets/queries";
import { type DialogContext, PocketActions, RestorePocket } from "@/modules/pockets/ui/pocket-actions";
import { percentOf } from "@/modules/budgets/rules";
import { requireSession } from "@/platform/auth/session";
import { monthKey, today } from "@/platform/dates";
import { formatDate, formatMoney, formatWholePercent } from "@/platform/format";
import { Badge } from "@/ui/badge";
import { cn } from "@/ui/cn";
import { KpiTile } from "@/ui/kpi-tile";
import { ProgressBar } from "@/ui/progress-bar";
import { Page } from "@/ui/shell/page";
import { EmptyState } from "@/ui/states";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("pockets"))("title") };
}

/** Pockets (spec §7.4): the figures of every pocket, and a card per pocket leading to its own page. */
export default async function PocketsPage() {
  const ctx = await requireSession();
  const t = await getTranslations("pockets");
  const view = await pocketsView(ctx);
  const todayOn = today(ctx.timeZone);
  const money = (cents: bigint | null, decimals = true) => formatMoney(cents, ctx.numberFormat, { decimals });
  const context: DialogContext = {
    accounts: view.accounts,
    numberFormat: ctx.numberFormat,
    locale: ctx.locale,
    today: todayOn,
    thisMonth: monthKey(todayOn),
  };

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

  if (view.pockets.length === 0) {
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

  return (
    <Page title={t("title")} actions={<PocketActions place="topbar" pocket={null} context={context} />}>
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

      <nav aria-label={t("list.label")} className="grid gap-4 @2xl:grid-cols-2 @6xl:grid-cols-3">
        {view.pockets.map((item) => {
          const target = item.pocket.targetCents;
          const percent = target === null ? null : percentOf(item.balanceCents, target);
          return (
            <Link
              key={item.pocket.id}
              href={`/pockets/${item.pocket.id}` as Route}
              data-testid="pocket-card"
              className="focus-ring flex min-w-0 flex-col gap-2 rounded-card border border-border bg-card p-4 hover:bg-hover"
            >
              <span className="flex items-center justify-between gap-2">
                <span className="truncate font-semibold">{item.pocket.name}</span>
                <span className="flex items-center gap-1.5 text-sm text-muted tabular-nums">
                  {item.pocket.state === "paused" && <Badge tone="neutral">{t("list.paused")}</Badge>}
                  {percent === null ? t("list.openEnded") : formatWholePercent(percent, ctx.numberFormat)}
                </span>
              </span>
              <span className="truncate text-sm text-muted">
                {item.accountName
                  ? t("detail.onAccount", { account: item.accountName })
                  : t("detail.standalone")}
              </span>
              <ProgressBar
                value={percent === null ? 0 : percent / 100}
                dashed={percent === null}
                label={item.pocket.name}
              />
              <span className="flex flex-wrap items-center justify-between gap-2 text-sm tabular-nums">
                <span>
                  <span className={cn("font-medium", item.balanceCents < 0n && "text-neg")}>
                    {money(item.balanceCents)}
                  </span>{" "}
                  <span className="text-muted">
                    {target === null
                      ? t("list.noTarget")
                      : t("list.ofTarget", { target: money(target, false) })}
                  </span>
                </span>
                {item.pocket.monthlyCents !== null && (
                  <span className="text-muted">
                    {t("list.perMonth", { amount: money(item.pocket.monthlyCents, false) })}
                  </span>
                )}
              </span>
              {item.planned.length > 0 && (
                <span className="text-sm text-muted tabular-nums">
                  {t("list.afterPlanned", { amount: money(item.projectedCents) })}
                </span>
              )}
            </Link>
          );
        })}
        <PocketActions place="new" pocket={null} context={context} />
      </nav>
      {archived}
    </Page>
  );
}
