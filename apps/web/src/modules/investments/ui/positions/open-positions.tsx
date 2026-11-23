"use client";

// The positions open on the period's last day (§3.4, PERS-113 · 4): by value, or under their asset
// class; with the cash, the total, and the commands of a manual position on the period still running.
// A table from `md`, a card each below it (DataTable). Every figure is a field of the API. A manual
// portfolio's position names where its price comes from (R5d), and its cash shows even at zero.
import { useTranslations } from "next-intl";
import { priceText, quantityText } from "@ledgerly/domain/investments/client";
import { formatDate, NULL_DISPLAY } from "@ledgerly/format/format";
import { Badge } from "@ledgerly/ui/badge";
import { Card, CardHeader } from "@ledgerly/ui/card";
import { type DataColumn, DataTable } from "@ledgerly/ui/data-table";
import { LinkTabs } from "@ledgerly/ui/link-controls";
import { Link } from "@ledgerly/ui/router";
import { Td, TotalRow, Tr } from "@ledgerly/ui/table";
import { TONE_TEXT, toneOfSign } from "@ledgerly/ui/tone";
import { HoldingMenu, type HoldingSummary, ReconcileButton } from "../holdings";
import { PriceMode } from "../portfolio/price-mode";
import { useProductLabel } from "../labels";
import { centsOf } from "../present";
import { PositionName } from "./position-name";
import type { OpenRow, PositionsPage } from "./positions-view";

type Text = ReturnType<typeof useTranslations<"investments.positions">>;

function useCells(view: PositionsPage) {
  const text = useTranslations("investments.positions");
  const { page, positions } = view;
  const { say, money, percent } = page;
  const classOf = (row: OpenRow) => view.assetOf(row.assetId)?.class ?? null;
  return {
    quantity: (row: OpenRow) =>
      row.at.quantity === null ? text("byValue") : quantityText(row.at.quantity, classOf(row), say.format),
    price: (row: OpenRow) =>
      row.at.unitPrice === null
        ? NULL_DISPLAY
        : priceText(row.at.unitPrice, row.at.priceCurrency, say.format),
    average: (row: OpenRow) =>
      row.at.averageCost === null
        ? NULL_DISPLAY
        : priceText(row.at.averageCost, positions.currency, say.format),
    onCost: (row: OpenRow) => (
      <span className={TONE_TEXT[row.at.onCost === null ? "muted" : toneOfSign(row.at.onCost)]}>
        {percent(row.at.onCost)}
      </span>
    ),
    pnl: (row: OpenRow) => (
      <span className="inline-flex flex-col items-end">
        <span className={TONE_TEXT[toneOfSign(centsOf(row.pnl))]}>{money(row.pnl, { signed: true })}</span>
        {row.pnl === null ? (
          <span className="text-xs text-muted">{text("noCost")}</span>
        ) : (
          row.periodReturn !== null && (
            <span className="text-xs text-muted">
              {text("periodReturn", { rate: percent(row.periodReturn) })}
            </span>
          )
        )}
      </span>
    ),
    name: (row: OpenRow) => {
      const asset = view.assetOf(row.assetId);
      const inferred = row.at.costSource === "inferred";
      const priced = page.context.portfolio ? asset : undefined;
      return (
        <PositionName
          view={view}
          assetId={row.assetId}
          product={row.product}
          manual={row.origin === "manual"}
          badge={
            inferred || priced ? (
              <>
                {inferred && <Badge tone="neutral">{text("inferredCost")}</Badge>}
                {priced && (
                  <PriceMode view={view} holdingId={row.holdingId} name={priced.name} price={priced.price} />
                )}
              </>
            ) : null
          }
        />
      );
    },
  };
}

/** Today's manual holding a row is, as its commands take it; null when no command applies. */
function holdingOf(view: PositionsPage, row: OpenRow): HoldingSummary | null {
  const { positions } = view;
  if (row.manual === null || row.holdingId === null || view.past) return null;
  const asset = view.assetOf(row.assetId) ?? { name: "", currency: positions.currency };
  const reading = positions.latestReading ?? { id: null, on: null };
  return {
    id: row.holdingId,
    name: asset.name,
    currency: asset.currency,
    origin: "manual",
    product: row.product ?? "",
    byValue: row.manual.byValue,
    quantityText: row.at.quantity,
    conflict: row.manual.conflict,
    readingId: reading.id,
    readingOn: reading.on,
  };
}

/** The commands act on today: only on the period still running, and on a manual position (§3.4). */
function Actions({ view, row }: { view: PositionsPage; row: OpenRow }) {
  const holding = holdingOf(view, row);
  const context = view.page.context;
  if (holding === null) return null;
  return (
    <span className="flex items-center justify-end gap-1">
      {holding.conflict && <ReconcileButton holding={holding} context={context} />}
      <HoldingMenu holding={holding} context={context} />
    </span>
  );
}

function useColumns(view: PositionsPage, text: Text): DataColumn<OpenRow>[] {
  const cells = useCells(view);
  const { money, percent } = view.page;
  return [
    { key: "asset", header: text("asset"), className: "max-w-64 py-1", cell: cells.name, card: "title" },
    { key: "quantity", header: text("quantity"), align: "right", cell: cells.quantity },
    { key: "average", header: text("average"), align: "right", cell: cells.average },
    { key: "price", header: text("price"), align: "right", cell: cells.price },
    { key: "value", header: text("value"), align: "right", cell: (row) => money(row.at.value) },
    {
      key: "pnl",
      header: view.short ? text("pnlOf", { period: view.short }) : text("pnl"),
      align: "right",
      className: "py-1",
      cell: cells.pnl,
    },
    { key: "onCost", header: text("onCost"), align: "right", cell: cells.onCost },
    { key: "share", header: text("share"), align: "right", cell: (row) => percent(row.share, false) },
    {
      key: "actions",
      header: text("actions"),
      hiddenHeader: true,
      align: "right",
      cell: (row) => <Actions view={view} row={row} />,
      card: "action",
    },
  ];
}

/** A position on a phone: its name and line on the left, its value, P&L and return on cost on the right. */
function OpenCard({ view, row }: { view: PositionsPage; row: OpenRow }) {
  const text = useTranslations("investments.positions");
  const cells = useCells(view);
  const { money, percent } = view.page;
  return (
    <>
      <span className="flex min-w-0 flex-col gap-0.5">
        {cells.name(row)}
        <span className="text-xs text-muted tabular-nums">
          {text("mobileLine", {
            quantity: cells.quantity(row),
            price: cells.price(row),
            average: cells.average(row),
          })}
        </span>
      </span>
      <span className="flex shrink-0 flex-col items-end gap-0.5 tabular-nums">
        <span className="font-medium">{money(row.at.value)}</span>
        {cells.pnl(row)}
        <span className="text-xs text-muted">{text("onCostShort", { rate: percent(row.at.onCost) })}</span>
        <Actions view={view} row={row} />
      </span>
    </>
  );
}

/** The rows under their asset class, in the server's order of the classes (largest value first). */
function useGroups(view: PositionsPage, grouping: "asset" | "class") {
  const text = useTranslations("investments");
  const { open } = view.positions;
  const { money, percent } = view.page;
  if (grouping === "asset") return [{ key: "all", label: null, rows: open.rows }];
  return open.byClass.map((group) => ({
    key: group.key,
    label: text(`classes.${group.key}`),
    summary: text("positions.groupSummary", {
      value: money(group.value),
      pnl: money(group.pnl, { signed: true }),
      share: percent(group.share, false),
    }),
    rows: open.rows.filter((row) => (view.assetOf(row.assetId)?.class ?? "other") === group.key),
  }));
}

function useTotals(view: PositionsPage, text: Text) {
  const { open, currency } = view.positions;
  const { money, percent } = view.page;
  const cash =
    open.cash !== null && (view.page.context.portfolio || centsOf(open.cash) !== 0n) ? open.cash : null;
  const cashName = (
    <span className="flex flex-col">
      <span className="font-medium">{text("cash")}</span>
      <span className="text-xs text-muted">{text("cashNote", { currency })}</span>
    </span>
  );
  const footer = (
    <>
      {cash !== null && (
        <Tr data-testid="cash-row">
          <Td className="py-1">{cashName}</Td>
          <Td align="right" />
          <Td align="right" />
          <Td align="right" />
          <Td align="right">{money(cash)}</Td>
          <Td align="right">{NULL_DISPLAY}</Td>
          <Td align="right" />
          <Td align="right">{percent(open.cashShare, false)}</Td>
          <Td align="right" />
        </Tr>
      )}
      <TotalRow label={text("total")}>
        <Td align="right" />
        <Td align="right" />
        <Td align="right" />
        <Td align="right">{money(open.total)}</Td>
        <Td align="right">{money(open.pnl, { signed: true })}</Td>
        <Td align="right" />
        <Td align="right">{(centsOf(open.total) ?? 0n) > 0n ? percent(1, false) : NULL_DISPLAY}</Td>
        <Td align="right" />
      </TotalRow>
    </>
  );
  const cardFooter = (
    <>
      {cash !== null && (
        <li className="flex items-start justify-between gap-3 border-t border-border px-4 py-3 text-sm">
          {cashName}
          <span className="font-medium tabular-nums">{money(cash)}</span>
        </li>
      )}
      <li className="flex items-center justify-between gap-3 border-t border-border bg-bg px-4 py-2.5 text-sm font-semibold">
        <span>{text("total")}</span>
        <span className="tabular-nums">{money(open.total)}</span>
      </li>
    </>
  );
  return { cash, footer, cardFooter };
}

function Empty({ view }: { view: PositionsPage }) {
  const text = useTranslations("investments.positions");
  const count = view.positions.closedEver.groups.length;
  return (
    <p data-testid="positions-empty" className="px-4 pb-4 text-sm text-muted">
      {count > 0 ? text("emptyWithClosed", { count }) : text("empty")}{" "}
      {count > 0 && (
        <Link
          href={view.page.href("positions", { status: "all" })}
          className="focus-ring inline-flex min-h-6 items-center rounded-sm text-accent hover:underline"
        >
          {text("all")} →
        </Link>
      )}
    </p>
  );
}

function Leftovers({ view }: { view: PositionsPage }) {
  const text = useTranslations("investments.positions");
  const { page, positions } = view;
  const productLabel = useProductLabel();
  if (positions.dust.length === 0) return null;
  return (
    <details data-testid="dust" className="border-t border-border px-4 py-2.5 text-sm">
      <summary className="focus-ring inline-flex min-h-6 cursor-pointer items-center rounded-sm text-muted">
        {text("dust", { count: positions.dust.length })}
      </summary>
      <p className="mt-1 text-muted">{text("dustNote")}</p>
      <ul className="mt-1 flex flex-col gap-0.5">
        {positions.dust.map((leftover) => {
          const asset = view.assetOf(leftover.assetId);
          return (
            <li key={`${leftover.assetId}|${leftover.product}`} className="flex justify-between gap-3">
              <span className="min-w-0 truncate">
                {[asset?.name ?? text("unknownAsset"), productLabel(leftover.product)].join(" · ")}
              </span>
              <span className="shrink-0 tabular-nums">
                {quantityText(leftover.quantity, asset?.class ?? null, page.say.format)}
              </span>
            </li>
          );
        })}
      </ul>
    </details>
  );
}

/** «Group by: Asset | Class» (§3.4, mockup 05). */
function GroupingTabs({ view, grouping }: { view: PositionsPage; grouping: "asset" | "class" }) {
  const text = useTranslations("investments.positions");
  return (
    <span className="flex items-center gap-2">
      <span className="text-muted max-md:sr-only">{text("groupBy")}</span>
      <LinkTabs
        label={text("groupBy")}
        path={`/investments/${view.page.id}/positions`}
        params={{ ...view.page.section.params }}
        name="by"
        current={grouping}
        options={[
          { value: "asset", label: text("byAsset") },
          { value: "class", label: text("byClass") },
        ]}
      />
    </span>
  );
}

/** «N positions have no cost»: the way to the Connection tab. */
function NoCostNote({ view }: { view: PositionsPage }) {
  const text = useTranslations("investments.positions");
  const count = view.positions.open.noCost;
  if (count === 0) return null;
  return (
    <p className="border-t border-border px-4 py-2.5 text-sm text-muted">
      {text("noCostNote", { count })}{" "}
      <Link
        href={view.page.href("connection")}
        className="focus-ring inline-flex min-h-6 items-center rounded-sm text-accent hover:underline"
      >
        {text("costLink")}
      </Link>
    </p>
  );
}

function OpenTable({ view, grouping }: { view: PositionsPage; grouping: "asset" | "class" }) {
  const text = useTranslations("investments.positions");
  const columns = useColumns(view, text);
  const groups = useGroups(view, grouping);
  const { cash, footer, cardFooter } = useTotals(view, text);
  if (view.positions.open.rows.length === 0 && cash === null) return <Empty view={view} />;
  return (
    <DataTable
      columns={columns}
      groups={groups}
      rowKey={(row) => row.key}
      rowProps={() => ({ "data-testid": "open-row" })}
      card={(row) => <OpenCard view={view} row={row} />}
      cardProps={() => ({
        "data-testid": "open-item",
        className: "flex items-start justify-between gap-3 border-t border-border px-4 py-3 text-sm",
      })}
      footer={footer}
      cardFooter={cardFooter}
    />
  );
}

export function OpenPositions({ view, grouping }: { view: PositionsPage; grouping: "asset" | "class" }) {
  const text = useTranslations("investments.positions");
  const { page, positions, past } = view;
  return (
    <Card padded={false} className="min-w-0">
      <CardHeader
        title={
          past
            ? text("openAtTitle", { date: formatDate(positions.period.to, "long", page.say.locale) })
            : text("openTitle")
        }
        actions={
          positions.open.rows.length > 1 ? <GroupingTabs view={view} grouping={grouping} /> : undefined
        }
      />
      {positions.startOn && positions.contributions && (
        <p className="-mt-1.5 px-4 pb-2.5 text-sm text-muted">
          {text("openNote", {
            period: page.name,
            date: formatDate(positions.startOn, "long", page.say.locale),
          })}
        </p>
      )}
      <OpenTable view={view} grouping={grouping} />
      <NoCostNote view={view} />
      <Leftovers view={view} />
    </Card>
  );
}
