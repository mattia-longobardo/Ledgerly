"use client";

// The positions the period closed, or every close ever (S10): what was invested and what came back, and
// the realized total. A table from `md`, a card each below it (DataTable). Fields of the API.
import { useTranslations } from "next-intl";
import { formatDate } from "@ledgerly/format/format";
import { Card, CardHeader } from "@ledgerly/ui/card";
import { cn } from "@ledgerly/ui/cn";
import { type DataColumn, DataTable } from "@ledgerly/ui/data-table";
import { Td, TotalRow } from "@ledgerly/ui/table";
import { TONE_TEXT, toneOfSign } from "@ledgerly/ui/tone";
import { centsOf } from "../present";
import { useProviderWords } from "../provider-words";
import { PositionName } from "./position-name";
import type { ClosedGroup, PositionsPage } from "./positions-view";

function useCells(view: PositionsPage) {
  const text = useTranslations("investments.positions");
  const { money } = view.page;
  const locale = view.page.say.locale;
  return {
    name: (group: ClosedGroup) => (
      <PositionName
        view={view}
        assetId={group.assetId}
        product={group.product}
        manual={group.origin === "manual"}
        extra={
          group.positions > 0
            ? text("positionsCount", { count: group.positions })
            : text("exits", { count: group.count })
        }
      />
    ),
    dates: (group: ClosedGroup) =>
      group.openedOn === null
        ? formatDate(group.closedOn, "long", locale)
        : `${formatDate(group.openedOn, "dayMonth", locale)} → ${formatDate(group.closedOn, "long", locale)}`,
    realized: (group: ClosedGroup) => (
      <span className={TONE_TEXT[toneOfSign(centsOf(group.realized))]}>
        {money(group.realized, { signed: true })}
      </span>
    ),
  };
}

type Closed = PositionsPage["positions"]["closedEver"];

function ClosedTotal({ closed, money }: { closed: Closed; money: PositionsPage["page"]["money"] }) {
  const text = useTranslations("investments.positions");
  return (
    <TotalRow label={text("totalRealized")}>
      <Td />
      <Td align="right" />
      <Td align="right" />
      <Td align="right">
        <span
          data-testid="closed-total"
          data-cents={closed.realized === null ? "" : String(centsOf(closed.realized))}
        >
          {money(closed.realized, { signed: true })}
        </span>
      </Td>
      <Td align="right" />
    </TotalRow>
  );
}

function ClosedTotalCard({ closed, money }: { closed: Closed; money: PositionsPage["page"]["money"] }) {
  const text = useTranslations("investments.positions");
  return (
    <li className="flex items-center justify-between gap-3 border-t border-border bg-bg px-4 py-2.5 text-sm font-semibold">
      <span>{text("totalRealized")}</span>
      <span className="tabular-nums">{money(closed.realized, { signed: true })}</span>
    </li>
  );
}

function ClosedTable({ view, closed, invested }: { view: PositionsPage; closed: Closed; invested: boolean }) {
  const text = useTranslations("investments.positions");
  const { money, percent } = view.page;
  const cells = useCells(view);
  const columns: DataColumn<ClosedGroup>[] = [
    { key: "asset", header: text("asset"), className: "max-w-64 py-1", cell: cells.name },
    { key: "dates", header: text("dates"), cell: cells.dates },
    {
      key: "cost",
      header: invested ? text("invested") : text("cost"),
      align: "right",
      cell: (group) => money(group.cost),
    },
    { key: "proceeds", header: text("proceeds"), align: "right", cell: (group) => money(group.proceeds) },
    { key: "realized", header: text("realized"), align: "right", cell: cells.realized },
    { key: "onCost", header: text("onCost"), align: "right", cell: (group) => percent(group.onCost) },
  ];
  return (
    <DataTable
      columns={columns}
      rows={closed.groups}
      rowKey={(group) => group.holdingId}
      rowProps={() => ({ "data-testid": "closed-row" })}
      card={(group) => (
        <>
          <span className="flex min-w-0 flex-col gap-0.5">
            {cells.name(group)}
            <span className="text-xs text-muted">{cells.dates(group)}</span>
          </span>
          <span className="flex shrink-0 flex-col items-end tabular-nums">
            <span className={cn("font-medium", TONE_TEXT[toneOfSign(centsOf(group.realized))])}>
              {money(group.realized, { signed: true })}
            </span>
            <span className="text-xs text-muted">
              {money(group.cost)} → {money(group.proceeds)}
            </span>
          </span>
        </>
      )}
      cardProps={() => ({
        "data-testid": "closed-item",
        className: "flex items-start justify-between gap-3 border-t border-border px-4 py-3 text-sm",
      })}
      footer={<ClosedTotal closed={closed} money={money} />}
      cardFooter={<ClosedTotalCard closed={closed} money={money} />}
    />
  );
}

export function ClosedPositions({ view, all }: { view: PositionsPage; all: boolean }) {
  const text = useTranslations("investments.positions");
  const { page, positions } = view;
  // A provider whose closes come matched with their opening says what was invested, not a cost.
  const matchedNote = useProviderWords(page.overview.service.provider?.id)?.closedNote;
  const closed = all ? positions.closedEver : positions.closedInPeriod;
  return (
    <Card padded={false} className="min-w-0">
      <CardHeader title={all ? text("allTitle") : text("closedTitle", { period: page.name })} />
      <p className="-mt-1.5 px-4 pb-2.5 text-sm text-muted">{matchedNote ?? text("closedNote")}</p>
      {closed.groups.length === 0 ? (
        <p data-testid="positions-empty" className="px-4 pb-4 text-sm text-muted">
          {all ? text("emptyAll") : text("emptyClosed", { period: page.name })}
        </p>
      ) : (
        <ClosedTable view={view} closed={closed} invested={matchedNote !== undefined} />
      )}
    </Card>
  );
}
