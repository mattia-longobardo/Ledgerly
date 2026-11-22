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
import { type RegisterCells, type RegisterGroup, STATE_TONE, type SummedField } from "./present";

const MAIN: readonly SummedField[] = ["gross", "taxesTotal", "employeeSocial", "netPay"];
const DETAILS: readonly SummedField[] = [
  "irpefGross",
  "taxDeductions",
  "regionalInstallment",
  "substituteTax",
  "refund730",
  "welfareCash",
  "employeeFundEffective",
  "employerFundEffective",
  "tfrSelected",
];
const LABEL: Record<SummedField, string> = {
  gross: "gross",
  taxesTotal: "taxes",
  employeeSocial: "social",
  netPay: "net",
  irpefGross: "irpefGross",
  taxDeductions: "deductions",
  regionalInstallment: "surtax",
  substituteTax: "substitute",
  refund730: "refund730",
  welfareCash: "welfare",
  employeeFundEffective: "fundYou",
  employerFundEffective: "fundEmployer",
  tfrSelected: "tfr",
};

type Text = ReturnType<typeof useTranslations<"payroll">>;

function Month({ row, text }: { row: RegisterCells; text: Text }) {
  return (
    <span className="inline-flex items-center gap-2">
      {row.month}
      {row.badge && <Badge tone="accent">{text(`register.${row.badge}`)}</Badge>}
    </span>
  );
}

function columnsOf(fields: readonly SummedField[], details: boolean, text: Text): DataColumn<RegisterCells>[] {
  const amount = (field: SummedField): DataColumn<RegisterCells> => ({
    key: field,
    header: text(`register.${LABEL[field]}` as never),
    align: "right",
    className: (row) => cn(field === "netPay" && row.applied && "font-medium text-pos"),
    cell: (row) => row.values[field],
  });
  const leave: DataColumn<RegisterCells>[] = [
    { key: "vacationLeft", header: text("register.vacationLeft"), align: "right", cell: (row) => row.vacationLeft },
    { key: "rolLeft", header: text("register.rolLeft"), align: "right", cell: (row) => row.rolLeft },
  ];
  return [
    { key: "month", header: text("register.month"), rowHeader: true, cell: (row) => <Month row={row} text={text} /> },
    ...fields.map(amount),
    ...(details ? leave : []),
    {
      key: "document",
      header: text("register.document"),
      className: "max-w-56 truncate",
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
          <span className="text-sm">{row.fileName}</span>
        ),
    },
    {
      key: "status",
      header: text("register.status"),
      cell: (row) => (
        <span className="inline-flex items-center gap-1.5">
          <StatusBadge status={row.state} tones={STATE_TONE}>
            {text(`states.${row.state}`)}
          </StatusBadge>
          {row.warnings > 0 && (
            <span title={text("register.warningsHint")}>
              <Badge tone="warn">{text("register.warningsBadge", { count: row.warnings })}</Badge>
            </span>
          )}
        </span>
      ),
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
          {row.applied ? text("register.open") : text("register.review")}
        </Link>
      ),
    },
  ];
}

/** A year's totals and monthly means: rows of the table under its payslips. */
function GroupTotals({ group, fields, span, text }: { group: RegisterGroup; fields: readonly SummedField[]; span: number; text: Text }) {
  const line = (label: string, values: RegisterGroup["totals"], className: string) => (
    <tr className={cn("h-8 border-b border-border bg-bg", className)}>
      <th scope="row" className="px-2 pl-4 text-left whitespace-nowrap">
        {label}
      </th>
      {fields.map((field) => (
        <Td key={field} align="right">
          {values[field]}
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

function PhoneCard({ row, text }: { row: RegisterCells; text: Text }) {
  return (
    <Link href={row.href} className="flex items-center justify-between gap-3 px-3 py-2.5">
      <span className="flex min-w-0 flex-col">
        <span className="flex items-center gap-2 font-medium">
          <Month row={row} text={text} />
        </span>
        <span className="text-sm text-muted">
          {text("register.gross")} {row.values.gross}
        </span>
      </span>
      <span className="flex flex-col items-end gap-1">
        <span className="font-medium tabular-nums">{row.values.netPay}</span>
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
 * the applied payslips; detail columns on demand. Below 768 px it is a list (spec §8.2).
 */
export function RegisterTable({ groups }: { groups: RegisterGroup[] }) {
  const text = useTranslations("payroll");
  const [details, setDetails] = useState(false);
  const fields = details ? [...MAIN, ...DETAILS] : MAIN;
  const columns = columnsOf(fields, details, text);

  return (
    <section aria-label={text("register.label")} className="flex min-h-0 flex-col gap-2">
      <div className="flex justify-end max-md:hidden">
        <Button size="xs" variant="ghost" onClick={() => setDetails((value) => !value)} aria-pressed={details}>
          {details ? text("register.hideDetails") : text("register.details")}
        </Button>
      </div>
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
              <span className="font-medium text-fg tabular-nums">{group.totals.netPay}</span>
            </p>
          ),
        }))}
        card={(row) => <PhoneCard row={row} text={text} />}
        cardProps={() => ({ className: "border-b border-border last:border-0" })}
      />
    </section>
  );
}
