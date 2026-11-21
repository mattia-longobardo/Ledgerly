"use client";

// The sections of the Payroll page above the register (spec §7.8 "Registro", D13): the heading with
// the span and the payslips waiting, the tabs, the KPIs over the applied ordinary payslips and the
// documents with no payslip to show yet. Every figure is a field of `GET /payroll/payslips`.
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

export function RegisterHeader({ view, format }: Props) {
  const text = useTranslations("payroll");
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex flex-wrap items-baseline gap-3">
        <h1 className="text-title font-semibold tracking-title max-md:sr-only">{text("title")}</h1>
        <p className="text-muted">
          {view.span
            ? text("summary", {
                count: view.applied,
                from: formatDate(view.span.from, "monthShort", format.locale),
                to: formatDate(view.span.to, "monthShort", format.locale),
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

export function RegisterKpis({ view, format }: Props) {
  const text = useTranslations("payroll");
  const { kpis } = view;
  return (
    <div className="grid grid-cols-2 gap-4 @3xl:grid-cols-5">
      <KpiTile label={text("kpis.net3")} value={moneyOf(kpis.net3, format)} note={text("kpis.ordinaryOnly")} />
      <KpiTile label={text("kpis.net6")} value={moneyOf(kpis.net6, format)} />
      <KpiTile label={text("kpis.net12")} value={moneyOf(kpis.net12, format)} />
      <KpiTile
        label={text("kpis.taxRate")}
        value={kpis.taxRate === null ? NULL_DISPLAY : formatPercent(kpis.taxRate, format.numberFormat)}
      />
      <KpiTile
        label={text("kpis.ral")}
        value={moneyOf(kpis.ral?.amount, format)}
        note={
          kpis.ral
            ? text(kpis.ral.basis === "complete_year" ? "kpis.ralComplete" : "kpis.ralEstimate", {
                year: kpis.ral.year,
              })
            : undefined
        }
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
