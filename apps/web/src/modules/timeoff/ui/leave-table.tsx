"use client";

// The table of the Time off page, month by month (N7), with the design's three filters.
import { Fragment } from "react";
import { formatDate } from "@ledgerly/format/format";
import { Badge } from "@ledgerly/ui/badge";
import { Card, CardHeader } from "@ledgerly/ui/card";
import { cn } from "@ledgerly/ui/cn";
import { useRouter } from "@ledgerly/ui/router";
import { Segmented } from "@ledgerly/ui/segmented";
import { GroupRow, Table, TBody, Td, Th, THead, Tr } from "@ledgerly/ui/table";
import { KIND_CLASS } from "./kinds";
import { RowActions } from "./leave-actions";
import { daysOf, type MonthGroup, monthSummary, type Say, type View } from "./words";
import { type Filter, FILTERS, yearHref } from "./year";

type DayRow = Extract<View["rows"][number], { source: "day" }>;

/**
 * The payslip's own figures are no longer rows of their own: they belong in the heading of the
 * month they are about, next to what is actually written down, because the whole reason to put
 * them together is that a person can see them disagree.
 *
 * A month is shown when it holds something or when a payslip has something to say about it — so a
 * month the employer counted leave in and this calendar has nothing for still appears, which is
 * exactly the month worth looking at. Under a filter, a month with no matching day is left out: the
 * filter was asked for.
 */
function groupsOf(view: View, filter: Filter): { month: MonthGroup; rows: DayRow[] }[] {
  const dayRows = view.rows.filter(
    (row): row is DayRow => row.source === "day" && (filter === "all" || row.status === filter),
  );
  return view.months
    .map((month) => ({
      month,
      rows: dayRows.filter((row) => row.on.slice(0, 7) === month.month.slice(0, 7)),
    }))
    .filter((group) =>
      filter === "all" ? group.rows.length > 0 || group.month.payroll !== null : group.rows.length > 0,
    );
}

export function LeaveTable({
  view,
  year,
  filter,
  say,
}: {
  view: View;
  year: number;
  filter: Filter;
  say: Say;
}) {
  const { text } = say;
  const router = useRouter();
  const groups = groupsOf(view, filter);
  return (
    // `min-w-0`: without it a flex child sizes to its content, and the table inside would push the
    // card — and the whole page — wider than the phone rather than scrolling in place.
    <Card padded={false} className="min-w-0">
      <CardHeader
        title={text("table.title")}
        actions={
          // The filter is in the URL, as the year is (audit UI-TOF-4: the one `Segmented`).
          <Segmented
            label={text("table.title")}
            value={filter}
            onChange={(next) => router.push(yearHref(year, next))}
            options={FILTERS.map((one) => ({ value: one, label: text(`table.filters.${one}`) }))}
          />
        }
      />
      {groups.length === 0 ? (
        <p className="px-4 pb-4 text-muted">{text("table.empty")}</p>
      ) : (
        <Rows groups={groups} say={say} />
      )}
    </Card>
  );
}

/**
 * Six columns do not fit a 400 px phone. Rather than scroll the table sideways, the two that can be
 * said in less room step aside: the note goes, and the status moves under the date as the badge it
 * already is. Nothing is lost, and the page never scrolls.
 */
function Rows({ groups, say }: { groups: { month: MonthGroup; rows: DayRow[] }[]; say: Say }) {
  const { text, locale } = say;
  return (
    <div className="overflow-x-auto">
      <Table>
        <THead>
          <Th>{text("table.date")}</Th>
          <Th>{text("table.type")}</Th>
          <Th align="right">{text("table.duration")}</Th>
          <Th className="max-md:hidden">{text("table.note")}</Th>
          <Th className="max-md:hidden">{text("table.status")}</Th>
          <Th align="right">
            <span className="sr-only">{text("table.actions")}</span>
          </Th>
        </THead>
        <TBody>
          {groups.map((group) => (
            <Fragment key={group.month.month}>
              <GroupRow
                colSpan={6}
                label={formatDate(group.month.month, "monthYear", locale)}
                summary={monthSummary(say, group.month)}
              />
              {group.rows.map((row) => (
                <DayLine key={row.id} row={row} say={say} />
              ))}
            </Fragment>
          ))}
        </TBody>
      </Table>
    </div>
  );
}

function DayLine({ row, say }: { row: DayRow; say: Say }) {
  const { text, locale } = say;
  return (
    <Tr>
      <Td className="font-medium">
        <span className="flex flex-col gap-0.5">
          {formatDate(row.on, "long", locale)}
          <span className="flex flex-wrap items-center gap-1 md:hidden">
            <Status row={row} say={say} />
          </span>
        </span>
      </Td>
      <Td>
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden="true" className={cn("size-2 rounded-xs", KIND_CLASS[row.kind])} />
          {text(`kinds.${row.kind}`)}
        </span>
      </Td>
      <Td align="right" className="tabular-nums">
        {daysOf(say, row.fraction * say.minutesPerDay)}
      </Td>
      <Td muted className="max-w-0 truncate max-md:hidden">
        {row.note ?? ""}
      </Td>
      <Td className="max-md:hidden">
        <span className="flex flex-wrap items-center gap-1.5">
          <Status row={row} say={say} />
        </span>
      </Td>
      <Td align="right">
        <RowActions id={row.id} on={row.on} />
      </Td>
    </Tr>
  );
}

/** The badges a row wears: what the calendar makes of it today, and where it came from. */
function Status({ row, say }: { row: DayRow; say: Say }) {
  const { text } = say;
  return (
    <>
      <Badge tone={row.status === "taken" ? "neutral" : "accent"}>
        {text(`table.statuses.${row.status}`)}
      </Badge>
      {row.origin === "external" && <Badge tone="neutral">{text("table.fromExternal")}</Badge>}
      {row.sync !== "none" && <Badge tone="warn">{text(`table.pending.${row.sync}`)}</Badge>}
    </>
  );
}
