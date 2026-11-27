"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { Badge } from "@ledgerly/ui/badge";
import { Button } from "@ledgerly/ui/button";
import { cn } from "@ledgerly/ui/cn";
import { type DataColumn, DataTable } from "@ledgerly/ui/data-table";
import { Link } from "@ledgerly/ui/router";
import { StatusBadge } from "@ledgerly/ui/status-badge";
import { Td } from "@ledgerly/ui/table";
import { openOriginal, originalLink } from "./original";
import { NULL_DISPLAY } from "@ledgerly/format/format";
import { type Catalogue, type RegisterCells, type RegisterGroup, registerColumns, STATE_TONE } from "./present";
import { KindBadge, useColumnLabel } from "./labels";

type Text = ReturnType<typeof useTranslations<"payroll">>;

function Month({ row }: { row: RegisterCells }) {
  return (
    <span className="inline-flex items-center gap-2">
      {row.month}
      <KindBadge badge={row.badge} />
    </span>
  );
}

function Status({ row, text }: { row: RegisterCells; text: Text }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <StatusBadge status={row.state} tones={STATE_TONE}>
        {text(`states.${row.state}`)}
      </StatusBadge>
      {row.warnings > 0 && (
        <span title={text("register.warningsHint")}>
          <Badge tone="warn">{text("register.warningsBadge", { count: row.warnings })}</Badge>
        </span>
      )}
    </span>
  );
}

// Between the list (below 768 px) and a wide page the table steps two columns aside, so it fits the
// page column and nothing reaches past the window: the file below 1024 px of column (it opens from the
// payslip), the status below 896 px (the month shows it).
const NARROW_DOCUMENT = "@max-5xl:hidden";
const NARROW_STATUS = "@max-4xl:hidden";

function columnsOf(
  fields: readonly string[],
  details: boolean,
  text: Text,
  label: (field: string) => string,
): DataColumn<RegisterCells>[] {
  const amount = (field: string): DataColumn<RegisterCells> => ({
    key: field,
    header: label(field),
    align: "right",
    className: (row) => cn(field === "netPay" && row.applied && "font-medium text-pos"),
    cell: (row) => row.values[field] ?? NULL_DISPLAY,
  });
  const leave: DataColumn<RegisterCells>[] = [
    { key: "vacationLeft", header: text("register.vacationLeft"), align: "right", cell: (row) => row.vacationLeft },
    { key: "rolLeft", header: text("register.rolLeft"), align: "right", cell: (row) => row.rolLeft },
  ];
  return [
    {
      key: "month",
      header: text("register.month"),
      rowHeader: true,
      cell: (row) => (
        <span className="flex flex-col gap-0.5">
          <Month row={row} />
          {/* The status column steps aside on a narrow page: the month says it, as in Time off. */}
          <span className="@4xl:hidden">
            <Status row={row} text={text} />
          </span>
        </span>
      ),
    },
    ...fields.map(amount),
    ...(details ? leave : []),
    {
      key: "document",
      header: text("register.document"),
      headerClassName: NARROW_DOCUMENT,
      className: cn("max-w-56 truncate", NARROW_DOCUMENT),
      cell: (row) =>
        row.hasOriginal ? (
          <button
            type="button"
            onClick={() => openOriginal(() => originalLink(row.id))}
            className="focus-ring inline-flex min-h-6 items-center rounded-xs text-sm text-accent hover:underline"
          >
            {row.fileName}
          </button>
        ) : (
          <span className={cn("text-sm", row.fileName === "" && "text-muted")}>
            {row.fileName || text("register.byHand")}
          </span>
        ),
    },
    {
      key: "status",
      header: text("register.status"),
      headerClassName: NARROW_STATUS,
      className: NARROW_STATUS,
      cell: (row) => <Status row={row} text={text} />,
    },
    {
      key: "actions",
      header: text("register.actions"),
      hiddenHeader: true,
      align: "right",
      cell: (row) => (
        <Link
          href={row.href}
          className="focus-ring inline-flex h-6 items-center rounded-tag border border-border bg-card px-2 text-sm font-medium text-fg hover:bg-hover"
        >
          {row.applied || row.manual ? text("register.open") : text("register.review")}
        </Link>
      ),
    },
  ];
}

/** A year's totals and monthly means: rows of the table under its payslips. */
function GroupTotals({ group, fields, span, text }: { group: RegisterGroup; fields: readonly string[]; span: number; text: Text }) {
  const line = (label: string, values: RegisterGroup["totals"], className: string) => (
    <tr className={cn("h-8 border-b border-border bg-bg", className)}>
      <th scope="row" className="px-2 pl-4 text-left whitespace-nowrap">
        {label}
      </th>
      {fields.map((field) => (
        <Td key={field} align="right">
          {values[field] ?? NULL_DISPLAY}
        </Td>
      ))}
      <td colSpan={span - 1 - fields.length} />
    </tr>
  );
  return (
    <>
      {line(text("register.total", { year: group.year }), group.totals, "font-semibold")}
      {line(text("register.average"), group.averages, "font-medium text-muted")}
    </>
  );
}

function PhoneCard({ row, text, gross }: { row: RegisterCells; text: Text; gross: string }) {
  return (
    <Link href={row.href} className="flex items-center justify-between gap-3 px-3 py-2.5">
      <span className="flex min-w-0 flex-col">
        <span className="flex items-center gap-2 font-medium">
          <Month row={row} />
        </span>
        <span className="text-sm text-muted">
          {gross} {row.values.gross ?? NULL_DISPLAY}
        </span>
      </span>
      <span className="flex flex-col items-end gap-1">
        <span className="font-medium tabular-nums">{row.values.netPay ?? NULL_DISPLAY}</span>
        <StatusBadge status={row.state} tones={STATE_TONE}>
          {text(`states.${row.state}`)}
        </StatusBadge>
      </span>
    </Link>
  );
}

/**
 * The register of spec §7.8 (D13): one card as tall as the window below the KPIs, whatever the
 * number of rows, with a fixed header and a group per year with its totals and monthly averages over
 * the applied payslips; detail columns on demand. Below 768 px it is a list (spec §8.2). The amount
 * columns come from the catalogue of fields (R5g, E4: `registerColumns`).
 */
export function RegisterTable({ groups, catalogue }: { groups: RegisterGroup[]; catalogue: Catalogue }) {
  const text = useTranslations("payroll");
  const [details, setDetails] = useState(false);
  const { main, extra, details: hasDetails } = registerColumns(catalogue, groups);
  const fields = details ? [...main, ...extra] : main;
  const label = useColumnLabel();
  const columns = columnsOf(fields, details, text, label);

  return (
    <section aria-label={text("register.label")} className="flex min-h-0 flex-col gap-2">
      {hasDetails && (
        <div className="flex justify-end max-md:hidden">
          <Button size="xs" variant="ghost" onClick={() => setDetails((value) => !value)} aria-pressed={details}>
            {details ? text("register.hideDetails") : text("register.details")}
          </Button>
        </div>
      )}
      <DataTable
        columns={columns}
        rowKey={(row) => row.id}
        rowProps={(row) => ({ className: cn(!row.applied && "text-muted") })}
        stickyHeader
        frameClassName="h-[calc(100dvh-280px)] min-h-64 overflow-auto rounded-card border border-border bg-card"
        groups={groups.map((group) => ({
          key: String(group.year),
          label: String(group.year),
          rows: group.rows,
          footer: group.hasApplied && <GroupTotals group={group} fields={fields} span={columns.length} text={text} />,
          cardFooter: group.hasApplied && (
            <p className="flex justify-between px-4 py-2 text-sm text-muted">
              <span>{text("register.total", { year: group.year })}</span>
              <span className="font-medium text-fg tabular-nums">{group.totals.netPay ?? NULL_DISPLAY}</span>
            </p>
          ),
        }))}
        card={(row) => <PhoneCard row={row} text={text} gross={label("gross")} />}
        cardProps={() => ({ className: "border-b border-border last:border-0" })}
      />
    </section>
  );
}
