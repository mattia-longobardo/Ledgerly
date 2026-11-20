"use client";

// Pockets (spec §7.4), read from `/api/v1` (rewrite plan R3): every figure is a field of
// `GET /pockets`; the screen formats, it adds nothing up.
import Link from "next/link";
import { useTranslations } from "next-intl";
import { pockets as pocketRoutes } from "@ledgerly/api-contract/pockets";
import type { RouteOutput } from "@ledgerly/api-client";
import { parseCents } from "@ledgerly/format/cents";
import { formatDate, formatMoney, formatWholePercent } from "@ledgerly/format/format";
import { Badge } from "@ledgerly/ui/badge";
import { cn } from "@ledgerly/ui/cn";
import { useApi } from "@ledgerly/ui/data";
import { KpiTile } from "@ledgerly/ui/kpi-tile";
import { Loaded } from "@ledgerly/ui/loaded";
import { ProgressBar } from "@ledgerly/ui/progress-bar";
import { Page } from "@ledgerly/ui/shell/page";
import { EmptyState } from "@ledgerly/ui/states";
import { type DialogContext, PocketActions, RestorePocket, useDialogContext } from "@/modules/pockets/client";

type View = RouteOutput<typeof pocketRoutes.listPockets>;
type Row = View["pockets"][number];

/** An amount of the wire, formatted; null stays the empty mark. */
const moneyOf =
  (context: DialogContext) =>
  (amount: string | null, decimals = true) =>
    formatMoney(amount === null ? null : parseCents(amount), context.numberFormat, { decimals });

function Archived({ view }: { view: View }) {
  const text = useTranslations("pockets");
  if (view.archived.length === 0) return null;
  return (
    <details className="text-sm">
      <summary className="cursor-pointer text-muted">
        {text("archived.count", { count: view.archived.length })}
      </summary>
      <ul className="mt-2 flex flex-col gap-1">
        {view.archived.map((pocket) => (
          <li key={pocket.id} className="flex items-center justify-between gap-2">
            <span>{pocket.name}</span>
            <RestorePocket id={pocket.id} />
          </li>
        ))}
      </ul>
    </details>
  );
}

function Kpis({ view, context }: { view: View; context: DialogContext }) {
  const text = useTranslations("pockets");
  const money = moneyOf(context);
  const { totals } = view;
  return (
    <div className="grid grid-cols-2 gap-4 @4xl:grid-cols-4">
      <KpiTile
        label={text("kpis.earmarked")}
        value={money(totals.earmarked)}
        note={text("kpis.count", { count: view.pockets.length })}
      />
      <KpiTile
        label={text("kpis.backing")}
        value={money(totals.backing)}
        note={
          view.backingAccounts.length > 0
            ? view.backingAccounts.map((account) => account.name).join(" · ")
            : text("kpis.noBacking")
        }
      />
      <KpiTile
        label={text("kpis.free")}
        value={money(totals.free)}
        valueTone={totals.free !== null && parseCents(totals.free) < 0n ? "neg" : "pos"}
        note={text("kpis.freeNote")}
      />
      <KpiTile
        label={text("kpis.monthly")}
        value={money(totals.monthly, false)}
        note={text("kpis.nextAccrual", { date: formatDate(view.nextAccrual, "dayMonth", context.locale) })}
      />
    </div>
  );
}

function PocketCard({ row, context }: { row: Row; context: DialogContext }) {
  const text = useTranslations("pockets");
  const money = moneyOf(context);
  return (
    <Link
      href={`/pockets/${row.id}`}
      data-testid="pocket-card"
      className="focus-ring flex min-w-0 flex-col gap-2 rounded-card border border-border bg-card p-4 hover:bg-hover"
    >
      <span className="flex items-center justify-between gap-2">
        <span className="truncate font-semibold">{row.name}</span>
        <span className="flex items-center gap-1.5 text-sm text-muted tabular-nums">
          {row.state === "paused" && <Badge tone="neutral">{text("list.paused")}</Badge>}
          {row.percent === null
            ? text("list.openEnded")
            : formatWholePercent(row.percent, context.numberFormat)}
        </span>
      </span>
      <span className="truncate text-sm text-muted">
        {row.account ? text("detail.onAccount", { account: row.account }) : text("detail.standalone")}
      </span>
      <ProgressBar
        value={row.percent === null ? 0 : row.percent / 100}
        dashed={row.percent === null}
        label={row.name}
      />
      <span className="flex flex-wrap items-center justify-between gap-2 text-sm tabular-nums">
        <span>
          <span className={cn("font-medium", parseCents(row.balance) < 0n && "text-neg")}>
            {money(row.balance)}
          </span>{" "}
          <span className="text-muted">
            {row.target === null
              ? text("list.noTarget")
              : text("list.ofTarget", { target: money(row.target, false) })}
          </span>
        </span>
        {row.monthly !== null && (
          <span className="text-muted">{text("list.perMonth", { amount: money(row.monthly, false) })}</span>
        )}
      </span>
      {row.planned.count > 0 && (
        <span className="text-sm text-muted tabular-nums">
          {text("list.afterPlanned", { amount: money(row.planned.after) })}
        </span>
      )}
    </Link>
  );
}

function PocketsView({ view, context }: { view: View; context: DialogContext }) {
  const text = useTranslations("pockets");
  if (view.pockets.length === 0)
    return (
      <>
        <h1 className="text-title font-semibold tracking-title max-md:sr-only">{text("title")}</h1>
        <EmptyState
          title={text("empty.title")}
          description={text("empty.description")}
          actions={<PocketActions place="empty" pocket={null} context={context} />}
        />
        <Archived view={view} />
      </>
    );
  return (
    <>
      <div className="flex flex-col gap-0.5">
        <h1 className="text-title font-semibold tracking-title max-md:sr-only">{text("title")}</h1>
        <p className="text-muted">{text("subtitle")}</p>
      </div>
      <Kpis view={view} context={context} />
      <nav aria-label={text("list.label")} className="grid gap-4 @2xl:grid-cols-2 @6xl:grid-cols-3">
        {view.pockets.map((row) => (
          <PocketCard key={row.id} row={row} context={context} />
        ))}
        <PocketActions place="new" pocket={null} context={context} />
      </nav>
      <Archived view={view} />
    </>
  );
}

export function PocketsScreen() {
  const text = useTranslations("pockets");
  const read = useApi(pocketRoutes.listPockets, {});
  const context = useDialogContext();
  return (
    <Page
      title={text("title")}
      actions={context && <PocketActions place="topbar" pocket={null} context={context} />}
    >
      <Loaded state={read}>{(view) => context && <PocketsView view={view} context={context} />}</Loaded>
    </Page>
  );
}
