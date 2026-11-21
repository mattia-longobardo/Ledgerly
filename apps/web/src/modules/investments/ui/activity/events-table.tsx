"use client";

// The events of the page under the heading of their month (§3.5), each in one sentence with what a sale
// realized and its commands: a table from `md`, a card each below it (DataTable).
import { useTranslations } from "next-intl";
import { formatDate, monthName } from "@ledgerly/format/format";
import { type DataColumn, DataTable } from "@ledgerly/ui/data-table";
import { TONE_TEXT, toneOfSign } from "@ledgerly/ui/tone";
import { useEventText } from "../event-text";
import { OperationMenu } from "../operations";
import { centsOf } from "../present";
import type { ServicePage } from "../service/service-view";
import { UnlinkTransferButton } from "../transfers";
import type { EventRow, Events } from "./activity-view";

/** "giugno 2026" → "Giugno 2026": a heading starts with a capital in every language. */
const capitalized = (words: string) => words.charAt(0).toLocaleUpperCase() + words.slice(1);

function Extra({ row }: { row: EventRow }) {
  const text = useTranslations("investments");
  const conversion = row.origin === "conversion";
  const adjustment =
    row.leg.kind === "adjustment" && row.adjustmentClass !== null && row.adjustmentClass !== "data";
  if (!conversion && !adjustment) return null;
  return (
    <span className="flex flex-wrap items-center gap-x-2 text-xs">
      {conversion && <span className="text-muted">{text("operations.conversion")}</span>}
      {adjustment && row.adjustmentClass && (
        <span className="text-muted">{text(`operationForm.classes.${row.adjustmentClass}`)}</span>
      )}
    </span>
  );
}

function Actions({ page, row }: { page: ServicePage; row: EventRow }) {
  const text = useTranslations("investments");
  return (
    <span className="flex items-center justify-end gap-1">
      {row.transfer && (
        <UnlinkTransferButton
          accountId={page.id}
          eventId={row.id}
          label={`${text("operations.transferWith", { name: row.transfer.accountName })}, ${formatDate(row.on, "long", page.say.locale)}`}
        />
      )}
      <OperationMenu
        operation={{ id: row.id, kind: row.leg.kind, on: row.on, origin: row.origin, amount: row.leg.amount }}
        context={page.context}
      />
    </span>
  );
}

function Realized({ page, row }: { page: ServicePage; row: EventRow }) {
  if (row.realized === null) return null;
  return (
    <span className={TONE_TEXT[toneOfSign(centsOf(row.realized))]}>
      {page.money(row.realized, { signed: true })}
    </span>
  );
}

/** The rows of the page by month, with the month's count and what its sales realized. */
function useGroups(page: ServicePage, events: Events) {
  const text = useTranslations("investments");
  const byMonth = new Map(events.months.map((row) => [row.month, row]));
  const heading = (month: string) => {
    const row = byMonth.get(month);
    return [
      text("activityTab.month", {
        month: capitalized(`${monthName(`${month}-01`, page.say.locale, "long")} ${month.slice(0, 4)}`),
        count: row?.count ?? 0,
      }),
      row && centsOf(row.realized) !== 0n
        ? text("activityTab.monthRealized", { amount: page.money(row.realized, { signed: true }) })
        : null,
    ]
      .filter(Boolean)
      .join(" · ");
  };
  const groups: { key: string; label: string; rows: EventRow[] }[] = [];
  for (const row of events.rows) {
    const month = row.on.slice(0, 7);
    const last = groups.at(-1);
    if (last?.key === month) last.rows.push(row);
    else groups.push({ key: month, label: heading(month), rows: [row] });
  }
  return groups;
}

function useColumns(page: ServicePage): DataColumn<EventRow>[] {
  const text = useTranslations("investments");
  const describe = useEventText(page.say.format);
  return [
    {
      key: "date",
      header: text("activityTab.date"),
      muted: true,
      cell: (row) => formatDate(row.on, "dayMonth", page.say.locale),
    },
    { key: "type", header: text("activityTab.type"), cell: (row) => describe(row).label },
    {
      key: "description",
      header: text("activityTab.description"),
      className: "py-1 whitespace-normal",
      cell: (row) => {
        const { detail } = describe(row);
        return (
          <span className="flex flex-col">
            {detail !== null && <span>{detail}</span>}
            <Extra row={row} />
          </span>
        );
      },
    },
    {
      key: "pnl",
      header: text("activityTab.pnl"),
      align: "right",
      cell: (row) => <Realized page={page} row={row} />,
    },
    {
      key: "amount",
      header: text("activityTab.amount"),
      align: "right",
      className: "font-medium",
      cell: (row) => page.money(row.leg.amount, { signed: true }),
    },
    {
      key: "actions",
      header: text("activityTab.actions"),
      hiddenHeader: true,
      align: "right",
      cell: (row) => <Actions page={page} row={row} />,
    },
  ];
}

/** An event on a phone: its sentence, day and what it realized; its amount and commands. */
function EventCard({ page, row }: { page: ServicePage; row: EventRow }) {
  const describe = useEventText(page.say.format);
  const words = describe(row);
  return (
    <>
      <span className="flex min-w-0 flex-col gap-0.5">
        <span>{words.detail === null ? words.label : `${words.label} · ${words.detail}`}</span>
        <span className="text-xs text-muted">
          {formatDate(row.on, "long", page.say.locale)}
          {row.realized !== null && (
            <>
              {" · "}
              <Realized page={page} row={row} />
            </>
          )}
        </span>
        <Extra row={row} />
      </span>
      <span className="flex shrink-0 items-center gap-1">
        <span className="font-medium tabular-nums">{page.money(row.leg.amount, { signed: true })}</span>
        <Actions page={page} row={row} />
      </span>
    </>
  );
}

export function EventsTable({ page, events }: { page: ServicePage; events: Events }) {
  const columns = useColumns(page);
  const groups = useGroups(page, events);
  return (
    <DataTable
      columns={columns}
      groups={groups}
      rowKey={(row) => row.id}
      rowProps={() => ({ "data-testid": "activity-row" })}
      card={(row) => <EventCard page={page} row={row} />}
      cardProps={() => ({
        "data-testid": "activity-item",
        className: "flex items-start justify-between gap-3 border-t border-border px-4 py-2.5 text-sm",
      })}
    />
  );
}
