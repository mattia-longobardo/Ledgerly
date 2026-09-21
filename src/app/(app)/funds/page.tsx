import type { Metadata, Route } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { listAccounts } from "@/modules/accounts/queries";
import { asNumbers, axisLabels, monthLabels } from "@/modules/accounts/ui/display";
import { fundsView, valuationAccountOptions } from "@/modules/funds/queries";
import { FundStateButton, NewFundButton, ValuationButton } from "@/modules/funds/ui/fund-forms";
import { monthPill, newFundDraft } from "@/modules/funds/ui/present";
import { createPensionFundAction } from "./pension-setup";
import { requireSession } from "@/platform/auth/session";
import { today } from "@/platform/dates";
import { formatDate, formatMoney, formatPercent, NULL_DISPLAY } from "@/platform/format";
import { ButtonLink } from "@/ui/button";
import { Card, CardHeader } from "@/ui/card";
import { MultiLine } from "@/ui/chart";
import { cn } from "@/ui/cn";
import { KpiTile } from "@/ui/kpi-tile";
import { Page } from "@/ui/shell/page";
import { EmptyState } from "@/ui/states";
import { Table, TBody, Td, Th, THead, TotalRow, Tr } from "@/ui/table";
import { TONE_TEXT, toneOfSign } from "@/ui/tone";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("funds"))("title") };
}

const PILL = { pos: "bg-pos-bg text-pos", neg: "bg-neg-bg text-neg", muted: "bg-hover text-muted" } as const;

/** Funds (spec §7.7, design): the PACs in F4; the pension fund joins them in F6. */
export default async function FundsPage() {
  const ctx = await requireSession();
  const t = await getTranslations("funds");
  const todayOn = today(ctx.timeZone);
  const [view, accounts, valuationAccounts] = await Promise.all([
    fundsView(ctx),
    listAccounts(ctx),
    valuationAccountOptions(ctx),
  ]);
  const money = (cents: bigint | null) => formatMoney(cents, ctx.numberFormat);
  const open = accounts.map((account) => ({ id: account.id, name: account.name }));
  // One "Add fund" for both kinds (design "Fund kind"): the dialog asks which, and a pension fund
  // is created by the app-layer action, the only place allowed to call payroll and funds at once.
  const add = (label: string, size: "sm" | "md" = "sm") => (
    <NewFundButton
      draft={newFundDraft(todayOn)}
      accounts={open}
      valuationAccounts={valuationAccounts}
      createPension={createPensionFundAction}
      label={label}
      size={size}
    />
  );
  const labels = {
    found: (date: string) => t("month.found", { date }),
    awaited: t("month.awaited"),
    missing: t("month.missing"),
    none: t("month.none"),
  };
  const missing = view.rows.filter((row) => row.month.kind === "missing");
  const archived =
    view.archived.length > 0 ? (
      <details className="text-sm">
        <summary className="cursor-pointer text-muted">
          {t("archived.count", { count: view.archived.length })}
        </summary>
        <ul className="mt-2 flex flex-col gap-1">
          {view.archived.map((fund) => (
            <li key={fund.id} className="flex items-center justify-between gap-2">
              <Link href={`/funds/${fund.id}` as Route} className="hover:underline">
                {fund.name}
              </Link>
              <FundStateButton
                fundId={fund.id}
                state="active"
                label={t("archived.restore")}
                toast={t("toasts.restored")}
              />
            </li>
          ))}
        </ul>
      </details>
    ) : null;

  if (view.rows.length === 0) {
    return (
      <Page title={t("title")} actions={add(t("add"))}>
        <h1 className="text-title font-semibold tracking-[-0.02em] max-md:sr-only">{t("title")}</h1>
        <EmptyState
          title={t("empty.title")}
          description={t("empty.description")}
          actions={add(t("empty.cta"), "md")}
        />
        {archived}
      </Page>
    );
  }

  const values = view.valueSeries;
  return (
    <Page title={t("title")} actions={add(t("add"))}>
      {missing.length > 0 && (
        <section className="flex flex-col gap-2">
          {missing.map((row) => (
            <div
              key={row.fund.id}
              data-testid="fund-alert"
              className="flex flex-wrap items-center justify-between gap-2 rounded-card border border-neg/30 bg-neg-bg px-3 py-2 text-sm"
            >
              <p>
                <strong className="font-semibold">{row.fund.name}</strong> —{" "}
                {t("alert.missing", {
                  date: row.month.kind === "missing" ? formatDate(row.month.by, "long", ctx.locale) : "",
                  amount: money(row.fund.monthlyCents),
                })}
              </p>
              <Link
                href="/expenses"
                className="focus-ring inline-flex min-h-6 shrink-0 items-center rounded-[2px] font-medium text-accent hover:underline"
              >
                {t("alert.cta")}
              </Link>
            </div>
          ))}
        </section>
      )}

      <div className="flex flex-wrap items-baseline gap-3">
        <h1 className="text-title font-semibold tracking-[-0.02em] max-md:sr-only">{t("title")}</h1>
        <p className="text-muted">
          {t("summary", { value: money(view.valueCents), count: view.rows.length })}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 @4xl:grid-cols-4">
        <KpiTile label={t("kpis.value")} value={money(view.valueCents)} />
        <KpiTile label={t("kpis.paidIn")} value={money(view.paidInCents)} />
        <KpiTile
          label={t("kpis.gain")}
          value={
            view.gainCents === null
              ? NULL_DISPLAY
              : formatMoney(view.gainCents, ctx.numberFormat, { signed: true })
          }
          valueTone={toneOfSign(view.gainCents)}
        />
        <KpiTile label={t("kpis.monthly")} value={money(view.monthlyCents)} />
      </div>

      <Card className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">{t("chart.title")}</h2>
          <span className="flex gap-3 text-sm text-muted">
            <span className="flex items-center gap-1.5">
              <span aria-hidden className="h-0.5 w-4 bg-accent" /> {t("chart.value")}
            </span>
            <span className="flex items-center gap-1.5">
              <span aria-hidden className="w-4 border-t border-dashed border-muted" /> {t("chart.paid")}
            </span>
          </span>
        </div>
        <MultiLine
          series={[
            { values: asNumbers(values), color: "var(--accent)" },
            { values: asNumbers(view.paidSeries), color: "var(--muted)", dashed: true },
          ]}
          yLabels={axisLabels([...values, ...view.paidSeries], ctx.numberFormat)}
          xLabels={monthLabels(view.months, ctx.locale)}
          summary={t("chart.summary", { value: money(view.valueCents) })}
          height={160}
        />
      </Card>

      <Card padded={false}>
        <CardHeader
          title={t("table.title")}
          actions={<span className="text-sm text-muted">{t("table.hint")}</span>}
        />
        <div className="overflow-x-auto max-md:hidden">
          <Table>
            <THead>
              <Th>{t("table.fund")}</Th>
              <Th>{t("table.type")}</Th>
              <Th align="right">{t("table.paidIn")}</Th>
              <Th align="right">{t("table.value")}</Th>
              <Th align="right">{t("table.gain")}</Th>
              <Th align="right">{t("table.cumulative")}</Th>
              <Th>{t("table.lastValuation")}</Th>
              <Th>{t("table.month")}</Th>
              <Th align="right">
                <span className="sr-only">{t("table.edit")}</span>
              </Th>
            </THead>
            <TBody>
              {view.rows.map((row) => {
                const pill = monthPill(row.month, ctx.locale, labels);
                return (
                  <Tr key={row.fund.id} data-testid="fund-row">
                    <Td>
                      <Link
                        href={`/funds/${row.fund.id}` as Route}
                        className="inline-flex h-6 items-center font-medium hover:underline"
                      >
                        {row.fund.name}
                      </Link>
                    </Td>
                    <Td muted className="text-sm">
                      {[t(`types.${row.fund.type}`), row.fund.compartment].filter(Boolean).join(" · ")}
                    </Td>
                    {/* A pension fund fed by payslips alone shows what the transfer schedule has
                        already carried; it is the same paid-in as anyone else's and carries no
                        caption of its own (owner, 2026-09-20). */}
                    <Td align="right">{money(row.metrics.paidInCents)}</Td>
                    <Td align="right" className="font-semibold">
                      {money(row.metrics.valueCents)}
                    </Td>
                    <Td align="right" className={TONE_TEXT[toneOfSign(row.metrics.gainCents)]}>
                      {row.metrics.gainCents === null
                        ? NULL_DISPLAY
                        : formatMoney(row.metrics.gainCents, ctx.numberFormat, { signed: true })}
                    </Td>
                    <Td align="right" className={TONE_TEXT[toneOfSign(row.metrics.gainCents)]}>
                      {formatPercent(row.metrics.gainFraction, ctx.numberFormat, { signed: true })}
                    </Td>
                    <Td muted>
                      {row.lastValuation ? formatDate(row.lastValuation, "long", ctx.locale) : NULL_DISPLAY}
                    </Td>
                    <Td>
                      <span
                        className={cn(
                          "rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap",
                          PILL[pill.tone],
                        )}
                      >
                        {pill.text}
                      </span>
                    </Td>
                    <Td align="right">
                      <span className="flex justify-end gap-1">
                        <ButtonLink
                          href={`/funds/${row.fund.id}?tab=settings` as Route}
                          variant="ghost"
                          size="xs"
                        >
                          {t("table.edit")}
                        </ButtonLink>
                        <ValuationButton
                          fundId={row.fund.id}
                          fundName={row.fund.name}
                          today={todayOn}
                          lastLine={null}
                          label={t("table.valuation")}
                          place="row"
                        />
                      </span>
                    </Td>
                  </Tr>
                );
              })}
              <TotalRow label={t("table.total")}>
                <Td muted className="text-sm font-normal">
                  {t("table.perMonth", { amount: money(view.monthlyCents) })}
                </Td>
                <Td align="right">{money(view.paidInCents)}</Td>
                <Td align="right">{money(view.valueCents)}</Td>
                <Td align="right" className={TONE_TEXT[toneOfSign(view.gainCents)]}>
                  {view.gainCents === null
                    ? NULL_DISPLAY
                    : formatMoney(view.gainCents, ctx.numberFormat, { signed: true })}
                </Td>
                <Td />
                <Td />
                <Td />
                <Td />
              </TotalRow>
            </TBody>
          </Table>
        </div>
        <ul className="flex flex-col md:hidden">
          {view.rows.map((row) => (
            <li key={row.fund.id} data-testid="fund-item" className="border-b border-border last:border-0">
              <Link
                href={`/funds/${row.fund.id}` as Route}
                className="flex items-center justify-between gap-2 px-4 py-3"
              >
                <span className="flex min-w-0 flex-col">
                  <span className="truncate font-medium">{row.fund.name}</span>
                  <span className="text-sm text-muted">{money(row.metrics.paidInCents)}</span>
                </span>
                <span className="flex flex-col items-end tabular-nums">
                  <span className="font-semibold">{money(row.metrics.valueCents)}</span>
                  <span className={cn("text-sm", TONE_TEXT[toneOfSign(row.metrics.gainCents)])}>
                    {formatPercent(row.metrics.gainFraction, ctx.numberFormat, { signed: true })}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </Card>
      {archived}
    </Page>
  );
}
