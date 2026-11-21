"use client";

// A payslip's body lines with the role of each code (spec §7.8): a table from `md`, one card per line
// below it — seven columns do not fit a phone, and none of their figures is dropped (plan F9 §3.3).
import { useTranslations } from "next-intl";
import { Badge } from "@ledgerly/ui/badge";
import { Card } from "@ledgerly/ui/card";
import { type DataColumn, DataTable } from "@ledgerly/ui/data-table";
import { type Format, moneyOf, type Review } from "./present";

type Line = Review["lines"][number];
type Text = ReturnType<typeof useTranslations<"payroll">>;

/** An amount of a line; a blank one stays blank. */
const amountOf = (value: string | null, format: Format) => (value === null ? "" : moneyOf(value, format));

function RoleBadge({ line, text }: { line: Line; text: Text }) {
  return <Badge tone={line.role === "other" ? "warn" : "neutral"}>{text(`roles.${line.role}`)}</Badge>;
}

function columnsOf(format: Format, text: Text): DataColumn<Line>[] {
  return [
    { key: "code", header: text("review.lines.code"), className: "tabular-nums", cell: (line) => line.code },
    { key: "description", header: text("review.lines.description"), cell: (line) => line.description },
    { key: "quantity", header: text("review.lines.quantity"), align: "right", cell: (line) => line.quantity ?? "" },
    {
      key: "earnings",
      header: text("review.lines.earnings"),
      align: "right",
      cell: (line) => amountOf(line.earnings, format),
    },
    {
      key: "deductions",
      header: text("review.lines.deductions"),
      align: "right",
      cell: (line) => amountOf(line.deductions, format),
    },
    {
      key: "statistical",
      header: text("review.lines.statistical"),
      align: "right",
      muted: true,
      cell: (line) => amountOf(line.statistical, format),
    },
    { key: "role", header: text("review.lines.role"), cell: (line) => <RoleBadge line={line} text={text} /> },
  ];
}

function LineCard({ line, format, text }: { line: Line; format: Format; text: Text }) {
  return (
    <>
      <div className="flex items-start justify-between gap-2">
        <span className="min-w-0">
          <span className="tabular-nums text-muted">{line.code}</span> {line.description}
        </span>
        <RoleBadge line={line} text={text} />
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-sm tabular-nums">
        {line.quantity && (
          <span className="text-muted">
            {text("review.lines.quantity")} {line.quantity}
          </span>
        )}
        {line.earnings !== null && (
          <span>
            {text("review.lines.earnings")} {moneyOf(line.earnings, format)}
          </span>
        )}
        {line.deductions !== null && (
          <span>
            {text("review.lines.deductions")} {moneyOf(line.deductions, format)}
          </span>
        )}
        {line.statistical !== null && (
          <span className="text-muted">
            {text("review.lines.statistical")} {moneyOf(line.statistical, format)}
          </span>
        )}
      </div>
    </>
  );
}

export function ReviewLines({ view, format }: { view: Review; format: Format }) {
  const text = useTranslations("payroll");
  if (view.lines.length === 0) return null;
  return (
    <Card padded={false}>
      <h2 className="px-4 pt-3 pb-2 font-semibold">{text("review.lines.title")}</h2>
      <DataTable
        columns={columnsOf(format, text)}
        rows={view.lines}
        rowKey={(line) => String(line.position)}
        card={(line) => <LineCard line={line} format={format} text={text} />}
        cardProps={() => ({ className: "flex flex-col gap-1.5 border-b border-border px-4 py-3 last:border-0" })}
      />
    </Card>
  );
}
