"use client";

// The sections of the Payroll page above the register (spec §7.8 "Registro", D13): the heading with
// the year's payslips and those waiting, the tabs, the year's KPIs and the documents with no payslip
// to show yet. Every figure is a field of `GET /payroll/payslips`.
import { useTranslations } from "next-intl";
import { civilDateIn } from "@ledgerly/format/dates";
import { formatDate, formatPercent, NULL_DISPLAY } from "@ledgerly/format/format";
import { Card } from "@ledgerly/ui/card";
import { KpiTile } from "@ledgerly/ui/kpi-tile";
import { Link } from "@ledgerly/ui/router";
import { StatusBadge } from "@ledgerly/ui/status-badge";
import { TabLinks } from "@ledgerly/ui/tab-links";
import { type Format, moneyOf, type Register, STATE_TONE } from "./present";

interface Props {
  view: Register;
  format: Format;
}

type Year = Register["years"][number];

/** The applied payslips of a year and the months they span: the heading and the gross earned say it. */
function appliedSpan(year: Year | undefined): { count: number; from: string; to: string } | null {
  const applied = year?.rows.filter((row) => row.applied) ?? [];
  const periods = applied.flatMap((row) => (row.period ? [row.period] : [])).toSorted();
  return periods.length === 0 ? null : { count: applied.length, from: periods[0], to: periods.at(-1)! };
}

export function RegisterHeader({ view, year, format }: Props & { year: Year | undefined }) {
  const text = useTranslations("payroll");
  const span = appliedSpan(year);
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex flex-wrap items-baseline gap-3">
        <h1 className="text-title font-semibold tracking-title max-md:sr-only">{text("title")}</h1>
        <p className="text-muted">
          {span
            ? text("summary", {
                count: span.count,
                from: formatDate(span.from, "monthShort", format.locale),
                to: formatDate(span.to, "monthShort", format.locale),
              })
            : text("summaryEmpty")}
        </p>
      </div>
      {view.awaiting > 0 && (
        <span
          data-testid="awaiting-pill"
          className="inline-flex h-7 items-center gap-2 rounded-ctl border border-warn bg-warn-bg px-2.5 text-sm font-medium text-warn"
        >
          <span aria-hidden className="size-1.5 rounded-full bg-warn" />
          {text("awaiting", { count: view.awaiting })}
        </span>
      )}
    </div>
  );
}

/** Register and Settings: the two tabs of Payroll. */
export function PayrollTabs({ active }: { active: "register" | "settings" }) {
  const text = useTranslations("payroll");
  return (
    <TabLinks
      label={text("tabs.label")}
      tabs={[
        { href: "/payroll", label: text("tabs.register"), active: active === "register" },
        { href: "/payroll/settings", label: text("tabs.settings"), active: active === "settings" },
      ]}
    />
  );
}

/** The KPIs of the year chosen (owner's choice, 26/11/2026): gross earned and theoretical, net, tax rate. */
export function RegisterKpis({ year, format }: { year: Year; format: Format }) {
  const text = useTranslations("payroll");
  const { kpis } = year;
  const span = appliedSpan(year);
  const month = (period: string) => formatDate(period, "monthShort", format.locale);
  const theoretical = kpis.theoretical;
  return (
    <div className="grid grid-cols-2 gap-4 @3xl:grid-cols-5">
      <KpiTile
        testId="kpi-gross-effective"
        label={text("kpis.grossEffective", { year: year.year })}
        value={moneyOf(year.totals.gross, format)}
        note={span ? text("kpis.grossEffectiveNote", { from: month(span.from), to: month(span.to), count: span.count }) : undefined}
      />
      <KpiTile
        testId="kpi-gross-theoretical"
        label={text("kpis.grossTheoretical", { year: year.year })}
        value={moneyOf(theoretical?.amount, format)}
        note={
          theoretical
            ? text(theoretical.basis === "contractual" ? "kpis.theoreticalContractual" : "kpis.theoreticalGross", {
                month: month(theoretical.from),
                months: theoretical.months,
              })
            : text("kpis.theoreticalNone")
        }
      />
      <KpiTile label={text("kpis.netMonthly")} value={moneyOf(year.averages.netPay, format)} note={text("kpis.ordinaryOnly")} />
      <KpiTile label={text("kpis.net3")} value={moneyOf(kpis.net3, format)} note={text("kpis.ordinaryOnly")} />
      <KpiTile
        label={text("kpis.taxRate", { year: year.year })}
        value={kpis.taxRate === null ? NULL_DISPLAY : formatPercent(kpis.taxRate, format.numberFormat)}
      />
    </div>
  );
}

/** The documents being read, waiting for OCR, failed or unreadable: each opens its review. */
export function RegisterInbox({ view, format }: Props) {
  const text = useTranslations("payroll");
  if (view.inbox.length === 0) return null;
  return (
    <Card className="flex flex-col gap-2">
      <div>
        <h2 className="font-semibold">{text("inbox.title")}</h2>
        <p className="text-sm text-muted">{text("inbox.description")}</p>
      </div>
      <ul className="flex flex-col divide-y divide-border">
        {view.inbox.map((document) => (
          <li key={document.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
            <span className="flex min-w-0 flex-col">
              <span className="truncate font-medium">{document.fileName}</span>
              <span className="text-sm text-muted">
                {text("inbox.received", {
                  date: formatDate(civilDateIn(new Date(document.receivedAt), format.timeZone), "long", format.locale),
                })}
              </span>
            </span>
            <span className="flex items-center gap-2">
              <StatusBadge status={document.state} tones={STATE_TONE}>
                {text(`states.${document.state}`)}
              </StatusBadge>
              <Link
                href={`/payroll/${document.id}`}
                className="focus-ring inline-flex min-h-6 items-center rounded-xs text-sm font-medium text-accent hover:underline"
              >
                {text("inbox.open")}
              </Link>
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
