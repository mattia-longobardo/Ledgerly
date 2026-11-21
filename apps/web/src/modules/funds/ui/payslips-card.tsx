"use client";

import { useTranslations } from "next-intl";
import { formatDate, NULL_DISPLAY } from "@ledgerly/format/format";
import { Card, CardHeader } from "@ledgerly/ui/card";
import { type DataColumn, DataTable } from "@ledgerly/ui/data-table";
import { Link } from "@ledgerly/ui/router";
import { Td, TotalRow } from "@ledgerly/ui/table";
import { LINK, StatusBadge } from "./contribution-sections";
import type { Contributions } from "./contribution-setup";
import type { Say } from "@/platform/say";

type Payslip = Contributions["payslips"][number];
type Money = (amount: string | null) => string;

/** The payslip types the messages name; the wire's type is a string. */
const PAYSLIP_TYPES = ["ordinary", "thirteenth", "fourteenth", "fifteenth", "bonus", "settlement"] as const;
const payslipTypeOf = (type: string) => PAYSLIP_TYPES.find((one) => one === type) ?? "ordinary";

function PayslipLink({ documentId }: { documentId: string | null }) {
  const text = useTranslations("funds.fund.contributions");
  return documentId === null ? null : (
    <Link href={`/payroll/${documentId}`} className={LINK}>
      {text("payslips.open")}
    </Link>
  );
}

const payslipStatus = (one: Payslip) =>
  one.status === null ? null : <StatusBadge status={one.status} reason={one.reason} />;

interface PayslipsProps {
  payslips: Contributions["payslips"];
  totals: Contributions["payslipTotals"];
  label: (year: number, index: number) => string;
  money: Money;
  monthName: (one: Payslip) => string;
}

/** The payslips of the period (§5.3): one line per competence, with its period and its state. */
export function PayslipsCard({
  contributions,
  when,
  say,
  label,
  money,
}: {
  contributions: Contributions;
  when: string;
  say: Say;
  label: (year: number, index: number) => string;
  money: Money;
}) {
  const text = useTranslations("funds.fund.contributions");
  const pension = useTranslations("funds.pension");
  const { payslips, payslipTotals: totals } = contributions;
  const monthName = (one: Payslip) =>
    one.month
      ? formatDate(one.month, "monthYear", say.locale)
      : pension(`payslipTypes.${payslipTypeOf(one.payslipType)}`);
  const props = { payslips, totals, label, money, monthName };
  return (
    <Card padded={false} className="min-w-0" data-testid="fund-payslips">
      <CardHeader
        title={text("payslips.title")}
        actions={<span className="text-sm text-muted">{text("payslips.hint")}</span>}
      />
      {payslips.length === 0 ? (
        <p className="px-4 pb-4 text-sm text-muted" data-testid="payslips-empty">
          {text("payslips.empty", { when })}
        </p>
      ) : (
        <PayslipsTable {...props} />
      )}
    </Card>
  );
}

/** The payslips' columns; the three components also make the card's middle line. */
function usePayslipColumns({ label, money, monthName }: PayslipsProps) {
  const text = useTranslations("funds.fund.contributions");
  const parts = (["worker", "employer", "tfr"] as const).map((part): DataColumn<Payslip> => ({
    key: part,
    header: text(`components.${part}`),
    align: "right",
    cell: (one) => money(one[part]),
  }));
  const columns: DataColumn<Payslip>[] = [
    {
      key: "month",
      header: text("payslips.month"),
      cell: (one) => (
        <span className="flex flex-wrap items-center gap-2">
          {monthName(one)}
          <PayslipLink documentId={one.documentId} />
        </span>
      ),
    },
    {
      key: "period",
      header: text("payslips.period"),
      muted: true,
      cell: (one) => label(one.year, one.index),
    },
    ...parts,
    {
      key: "total",
      header: text("total"),
      align: "right",
      className: "font-semibold",
      cell: (one) => money(one.total),
    },
    { key: "status", header: text("payslips.status"), cell: (one) => payslipStatus(one) ?? NULL_DISPLAY },
  ];
  return { columns, parts };
}

function PayslipCard({
  one,
  parts,
  props,
}: {
  one: Payslip;
  parts: readonly DataColumn<Payslip>[];
  props: PayslipsProps;
}) {
  return (
    <>
      <div className="flex items-start justify-between gap-2">
        <span className="flex min-w-0 flex-col">
          <span className="font-medium">{props.monthName(one)}</span>
          <span className="text-sm text-muted">{props.label(one.year, one.index)}</span>
        </span>
        <span className="shrink-0 font-semibold tabular-nums">{props.money(one.total)}</span>
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-sm tabular-nums">
        {parts.map((column) => (
          <span key={column.key}>
            {column.header} {column.cell(one)}
          </span>
        ))}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        {payslipStatus(one) ?? <span />}
        <PayslipLink documentId={one.documentId} />
      </div>
    </>
  );
}

/** One line per competence: a table from `md`, a card each below it (DataTable). */
function PayslipsTable(props: PayslipsProps) {
  const text = useTranslations("funds.fund.contributions");
  const { payslips, totals, money } = props;
  const { columns, parts } = usePayslipColumns(props);
  return (
    <DataTable
      columns={columns}
      rows={payslips}
      rowKey={(one) => one.competenceId}
      rowProps={() => ({ "data-testid": "payslip-line" })}
      cardProps={() => ({ "data-testid": "payslip-item" })}
      card={(one) => <PayslipCard one={one} parts={parts} props={props} />}
      footer={
        <TotalRow label={text("total")}>
          <Td />
          <Td align="right">{money(totals.worker)}</Td>
          <Td align="right">{money(totals.employer)}</Td>
          <Td align="right">{money(totals.tfr)}</Td>
          <Td align="right">{money(totals.total)}</Td>
          <Td />
        </TotalRow>
      }
      cardFooter={
        <li className="flex items-center justify-between gap-2 px-4 py-3 font-medium">
          <span>{text("total")}</span>
          <span className="tabular-nums">{money(totals.total)}</span>
        </li>
      }
    />
  );
}
