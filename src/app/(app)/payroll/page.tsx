import type { Metadata, Route } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { registerView } from "@/modules/payroll/queries";
import { AddPayslips } from "@/modules/payroll/ui/add-payslips";
import { AutoRefresh } from "@/modules/payroll/ui/auto-refresh";
import { registerGroups, STATE_TONE } from "@/modules/payroll/ui/present";
import { RegisterTable } from "@/modules/payroll/ui/register-table";
import { requireSession } from "@/platform/auth/session";
import { civilDateIn } from "@/platform/dates";
import { formatDate, formatMoney, formatPercent, NULL_DISPLAY } from "@/platform/format";
import { Badge } from "@/ui/badge";
import { Card } from "@/ui/card";
import { KpiTile } from "@/ui/kpi-tile";
import { Page } from "@/ui/shell/page";
import { EmptyState } from "@/ui/states";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("payroll"))("title") };
}

/**
 * Payroll (spec §7.8 "Registro", D13): the register of payslips — one card as tall as the window,
 * grouped by year — under a compact strip of KPIs over the applied ordinary payslips. One "Add
 * payslip", in the topbar.
 */
export default async function PayrollPage() {
  const ctx = await requireSession();
  const t = await getTranslations("payroll");
  const view = await registerView(ctx);
  const money = (cents: bigint | null) => formatMoney(cents, ctx.numberFormat);
  const groups = registerGroups(view.years, ctx);
  const add = <AddPayslips label={t("add")} />;
  const empty = groups.length === 0 && view.inbox.length === 0;

  return (
    <Page title={t("title")} actions={add}>
      <AutoRefresh active={view.inFlight} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-baseline gap-3">
          <h1 className="text-title font-semibold tracking-[-0.02em] max-md:sr-only">{t("title")}</h1>
          <p className="text-muted">
            {view.span
              ? t("summary", {
                  count: view.applied,
                  from: formatDate(view.span.from, "monthShort", ctx.locale),
                  to: formatDate(view.span.to, "monthShort", ctx.locale),
                })
              : t("summaryEmpty")}
          </p>
        </div>
        {view.awaiting > 0 && (
          <span
            data-testid="awaiting-pill"
            className="inline-flex h-7 items-center gap-2 rounded-ctl border border-warn bg-warn-bg px-2.5 text-sm font-medium text-warn"
          >
            <span aria-hidden className="size-1.5 rounded-full bg-warn" />
            {t("awaiting", { count: view.awaiting })}
          </span>
        )}
      </div>

      {empty ? (
        <EmptyState
          title={t("empty.title")}
          description={t("empty.description")}
          actions={<AddPayslips label={t("empty.cta")} size="md" />}
        />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 @3xl:grid-cols-5">
            <KpiTile label={t("kpis.net3")} value={money(view.kpis.net3)} note={t("kpis.ordinaryOnly")} />
            <KpiTile label={t("kpis.net6")} value={money(view.kpis.net6)} />
            <KpiTile label={t("kpis.net12")} value={money(view.kpis.net12)} />
            <KpiTile
              label={t("kpis.taxRate")}
              value={view.kpis.taxRate === null ? NULL_DISPLAY : formatPercent(view.kpis.taxRate, ctx.numberFormat)}
            />
            <KpiTile
              label={t("kpis.ral")}
              value={money(view.kpis.ral?.cents ?? null)}
              note={
                view.kpis.ral
                  ? t(view.kpis.ral.basis === "complete_year" ? "kpis.ralComplete" : "kpis.ralEstimate", {
                      year: view.kpis.ral.year,
                    })
                  : undefined
              }
            />
          </div>

          {view.inbox.length > 0 && (
            <Card className="flex flex-col gap-2">
              <div>
                <h2 className="font-semibold">{t("inbox.title")}</h2>
                <p className="text-sm text-muted">{t("inbox.description")}</p>
              </div>
              <ul className="flex flex-col divide-y divide-border">
                {view.inbox.map((document) => (
                  <li key={document.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate font-medium">{document.fileName}</span>
                      <span className="text-sm text-muted">
                        {t("inbox.received", {
                          date: formatDate(civilDateIn(document.receivedAt, ctx.timeZone), "long", ctx.locale),
                        })}
                      </span>
                    </span>
                    <span className="flex items-center gap-2">
                      <Badge tone={STATE_TONE[document.state]}>{t(`states.${document.state}`)}</Badge>
                      <Link
                        href={`/payroll/${document.id}` as Route}
                        className="focus-ring inline-flex min-h-6 items-center rounded-[2px] text-sm font-medium text-accent hover:underline"
                      >
                        {t("inbox.open")}
                      </Link>
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {groups.length > 0 && <RegisterTable groups={groups} />}
        </>
      )}
    </Page>
  );
}
