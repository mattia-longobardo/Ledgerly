import type { Metadata, Route } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { LinkTabs } from "@/modules/accounts/ui/controls";
import { asNumbers, axisLabels, monthLabels } from "@/modules/accounts/ui/display";
import { fundDetail } from "@/modules/funds/queries";
import { FundError } from "@/modules/funds/service";
import {
  AddDepositCard,
  DeleteDeposit,
  DeleteValuation,
  DepositRuleForm,
  EditDepositButton,
  FundSettingsForm,
  FundStateButton,
  ValuationButton,
} from "@/modules/funds/ui/fund-forms";
import { depositDraft, fundDraft, newDepositDraft } from "@/modules/funds/ui/present";
import { formatRate } from "@/modules/interests/ui/present";
import { requireSession } from "@/platform/auth/session";
import { today } from "@/platform/dates";
import { formatDate, formatMoney, formatPercent, NULL_DISPLAY } from "@/platform/format";
import { Card, CardHeader } from "@/ui/card";
import { Bars, MultiLine } from "@/ui/chart";
import { cn } from "@/ui/cn";
import { KpiTile } from "@/ui/kpi-tile";
import { SettingsGrid, SettingsSection } from "@/ui/section";
import { Page } from "@/ui/shell/page";
import { TabLinks } from "@/ui/tab-links";
import { Table, TBody, Td, Th, THead, TotalRow, Tr } from "@/ui/table";
import { TONE_TEXT, toneOfSign } from "@/ui/tone";

const TABS = ["overview", "deposits", "valuations", "settings"] as const;
const SPANS = [
  { value: "6", label: "6M" },
  { value: "12", label: "1Y" },
  { value: "24", label: "2Y" },
] as const;

async function load(id: string, span: number) {
  const ctx = await requireSession();
  try {
    return { ctx, detail: await fundDetail(ctx, id, span) };
  } catch (error) {
    if (error instanceof FundError) notFound();
    throw error;
  }
}

export async function generateMetadata({ params }: PageProps<"/funds/[id]">): Promise<Metadata> {
  const { detail } = await load((await params).id, 12);
  return { title: detail.fund.name };
}

/** Fund detail (spec §7.7, design): Overview · Deposits · Valuations · Settings of a PAC. */
export default async function FundPage({ params, searchParams }: PageProps<"/funds/[id]">) {
  const { id } = await params;
  const query = await searchParams;
  const span = SPANS.find((one) => one.value === query.span)?.value ?? "12";
  const tab = TABS.find((one) => one === query.tab) ?? "overview";
  const { ctx, detail } = await load(id, Number(span));
  const t = await getTranslations("funds");
  const todayOn = today(ctx.timeZone);
  const money = (cents: bigint | null) => formatMoney(cents, ctx.numberFormat);
  const signed = (cents: bigint | null) =>
    cents === null ? NULL_DISPLAY : formatMoney(cents, ctx.numberFormat, { signed: true });
  const pct = (value: number | null) => formatPercent(value, ctx.numberFormat, { signed: true });
  const { fund, metrics } = detail;
  const base = `/funds/${fund.id}`;
  const lastValuation = detail.valuations[0] ?? null;
  const lastLine = lastValuation
    ? t("valuations.form.last", {
        value: money(lastValuation.valueCents),
        date: formatDate(lastValuation.on, "long", ctx.locale),
      })
    : null;
  const archived = fund.state === "archived";
  const monthNames = monthLabels(detail.months.slice(-12), ctx.locale);

  const tabs = (
    <TabLinks
      label={t("detail.tabs.label")}
      tabs={TABS.map((one) => ({
        href: (one === "overview" ? base : `${base}?tab=${one}`) as Route,
        label: t(`detail.tabs.${one}`),
        active: one === tab,
      }))}
    />
  );

  const depositsTable = (rows: typeof detail.deposits, withActions: boolean) => (
    <Table>
      <THead>
        <Th>{t("deposits.date")}</Th>
        <Th align="right">{t("deposits.debited")}</Th>
        <Th align="right">{t("deposits.fee")}</Th>
        <Th align="right">{t("deposits.invested")}</Th>
        <Th>{t("deposits.source")}</Th>
        {withActions && (
          <Th>
            <span className="sr-only">{t("deposits.edit")}</span>
          </Th>
        )}
      </THead>
      <TBody>
        {rows.map((deposit) => (
          <Tr key={deposit.id} data-testid="deposit-row">
            <Td muted>{formatDate(deposit.on, "long", ctx.locale)}</Td>
            <Td align="right">{money(deposit.chargedCents)}</Td>
            <Td align="right" className="text-neg">
              {deposit.feeCents === null ? NULL_DISPLAY : money(-deposit.feeCents)}
            </Td>
            <Td align="right" className="font-semibold">
              {money(deposit.investedCents)}
            </Td>
            <Td>
              <span
                className={cn(
                  "rounded-full px-2 py-0.5 text-xs font-medium",
                  deposit.source === "rule" ? "bg-pos-bg text-pos" : "bg-hover text-muted",
                )}
              >
                {t(`deposits.sources.${deposit.source}`)}
              </span>
            </Td>
            {withActions && (
              <Td>
                {!archived && (
                  <span className="flex gap-1">
                    <EditDepositButton
                      fundId={fund.id}
                      draft={depositDraft(deposit, ctx.numberFormat)}
                      format={ctx.numberFormat}
                      label={t("deposits.edit")}
                    />
                    {deposit.source === "manual" && (
                      <DeleteDeposit
                        fundId={fund.id}
                        depositId={deposit.id}
                        label={t("deposits.delete")}
                        toast={t("toasts.depositDeleted")}
                      />
                    )}
                  </span>
                )}
              </Td>
            )}
          </Tr>
        ))}
        {withActions && rows.length > 0 && (
          <TotalRow label={t("deposits.total")}>
            <Td align="right">{money(metrics.paidInCents)}</Td>
            <Td align="right" className="text-neg">
              {money(-metrics.feesCents)}
            </Td>
            <Td align="right">{money(metrics.investedCents)}</Td>
            <Td />
            <Td />
          </TotalRow>
        )}
      </TBody>
    </Table>
  );

  return (
    <Page
      title={fund.name}
      parent={{ href: "/funds", label: t("title") }}
      actions={
        !archived && (
          <ValuationButton
            fundId={fund.id}
            fundName={fund.name}
            today={todayOn}
            lastLine={lastLine}
            label={t("table.valuation")}
          />
        )
      }
    >
      <div className="flex flex-col gap-1">
        <p className="text-sm text-muted">
          {[
            t("detail.kind"),
            fund.provider,
            fund.compartment,
            t("detail.since", { date: formatDate(fund.startOn, "monthYear", ctx.locale) }),
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
        <h1 className="text-title font-semibold tracking-[-0.02em]">{fund.name}</h1>
        <p className="text-hero font-semibold tracking-[-0.02em] tabular-nums">
          {metrics.valueCents === null ? t("detail.noValue") : money(metrics.valueCents)}
        </p>
        <p className="flex flex-wrap gap-x-2 text-sm">
          <span className={cn("font-medium", TONE_TEXT[toneOfSign(metrics.gainCents)])}>
            {signed(metrics.gainCents)} · {pct(metrics.gainFraction)} {t("detail.cumulative")}
          </span>
          {lastValuation && (
            <span className="text-muted">
              {t("detail.asOf", {
                paidIn: money(metrics.paidInCents),
                date: formatDate(lastValuation.on, "long", ctx.locale),
              })}
            </span>
          )}
        </p>
      </div>

      {tabs}

      {tab === "overview" && (
        <>
          <div className="grid grid-cols-2 gap-4 @4xl:grid-cols-4">
            <KpiTile
              label={t("detail.kpis.invested")}
              value={money(metrics.investedCents)}
              note={
                metrics.investedPartial
                  ? t("detail.kpis.investedPartial")
                  : t("detail.kpis.investedNote", { count: detail.deposits.length })
              }
            />
            <KpiTile
              label={t("detail.kpis.fees")}
              value={money(-metrics.feesCents)}
              valueTone={metrics.feesCents > 0n ? "neg" : "fg"}
              note={
                fund.depositFeeCents === null
                  ? t("detail.kpis.feesNone")
                  : t("detail.kpis.feesNote", { fee: money(fund.depositFeeCents) })
              }
            />
            <KpiTile
              label={t("detail.kpis.gain")}
              value={signed(metrics.gainCents)}
              valueTone={toneOfSign(metrics.gainCents)}
              note={t("detail.kpis.gainNote", { percent: pct(metrics.gainFraction) })}
            />
            <KpiTile
              label={t("detail.kpis.year")}
              value={pct(detail.stats.compounded)}
              valueTone={
                detail.stats.compounded === null ? "fg" : detail.stats.compounded >= 0 ? "pos" : "neg"
              }
              note={
                fund.ter === null
                  ? t("detail.kpis.yearNoTer")
                  : t("detail.kpis.yearNote", { ter: formatRate(fund.ter, ctx.numberFormat) })
              }
            />
          </div>

          <Card className="flex flex-col gap-3" data-testid="fund-chart">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-lg font-semibold">{t("detail.chart.title", { months: span })}</h2>
              <LinkTabs
                label={t("detail.chart.title", { months: span })}
                path={base}
                params={{}}
                name="span"
                current={span}
                options={SPANS}
              />
            </div>
            <MultiLine
              series={[
                { values: asNumbers(detail.valueSeries), color: "var(--accent)" },
                { values: asNumbers(detail.paidSeries), color: "var(--muted)", dashed: true },
              ]}
              yLabels={axisLabels([...detail.valueSeries, ...detail.paidSeries], ctx.numberFormat)}
              xLabels={monthLabels(detail.months, ctx.locale)}
              summary={t("detail.chart.summary", { name: fund.name, value: money(metrics.valueCents) })}
              height={220}
            />
          </Card>

          <div className="grid items-start gap-4 @4xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
            <Card className="flex flex-col gap-3" data-testid="fund-returns">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-lg font-semibold">{t("detail.returns.title")}</h2>
                {detail.stats.counted > 0 && detail.stats.compounded !== null && (
                  <span className="text-sm text-muted">
                    {t("detail.returns.avg", {
                      value: pct(
                        detail.returns.reduce<number>((sum, value) => sum + (value ?? 0), 0) /
                          detail.stats.counted,
                      ),
                    })}
                  </span>
                )}
              </div>
              {detail.stats.counted === 0 ? (
                <p className="text-sm text-muted">{t("detail.returns.empty")}</p>
              ) : (
                <>
                  <Bars
                    values={detail.returns.map((value) => (value === null ? null : value * 100))}
                    yLabels={[]}
                    xLabels={monthNames}
                    summary={detail.returns
                      .map((value, index) =>
                        t("detail.returns.bar", { month: monthNames[index], value: pct(value) }),
                      )
                      .join(", ")}
                    height={100}
                  />
                  <dl className="grid grid-cols-3 gap-2 text-sm">
                    <div>
                      <dt className="text-muted">{t("detail.returns.best")}</dt>
                      <dd className="font-medium text-pos">{pct(detail.stats.best)}</dd>
                    </div>
                    <div>
                      <dt className="text-muted">{t("detail.returns.worst")}</dt>
                      <dd className="font-medium text-neg">{pct(detail.stats.worst)}</dd>
                    </div>
                    <div>
                      <dt className="text-muted">{t("detail.returns.positive")}</dt>
                      <dd className="font-medium">
                        {t("detail.returns.positiveValue", {
                          positive: detail.stats.positive,
                          counted: detail.stats.counted,
                        })}
                      </dd>
                    </div>
                  </dl>
                </>
              )}
            </Card>
            <Card padded={false}>
              <CardHeader
                title={t("detail.recent.title")}
                actions={
                  <Link href={`${base}?tab=deposits` as Route} className="text-accent hover:underline">
                    {t("detail.recent.all")}
                  </Link>
                }
              />
              {detail.deposits.length === 0 ? (
                <p className="px-4 pb-4 text-sm text-muted">{t("deposits.empty")}</p>
              ) : (
                depositsTable(detail.deposits.slice(0, 4), false)
              )}
            </Card>
          </div>
        </>
      )}

      {tab === "deposits" && (
        <div className="grid items-start gap-4 @4xl:grid-cols-[minmax(0,8fr)_minmax(0,4fr)]">
          <Card padded={false}>
            <CardHeader
              title={t("deposits.title")}
              actions={
                <span className="text-sm text-muted">
                  {t("deposits.hint", { count: detail.deposits.length })}
                </span>
              }
            />
            {detail.deposits.length === 0 ? (
              <p className="px-4 pb-4 text-sm text-muted">{t("deposits.empty")}</p>
            ) : (
              <div className="overflow-x-auto">{depositsTable(detail.deposits, true)}</div>
            )}
          </Card>
          <div className="flex flex-col gap-4">
            {!archived && (
              <AddDepositCard
                fundId={fund.id}
                draft={newDepositDraft(fund, todayOn, ctx.numberFormat)}
                format={ctx.numberFormat}
              />
            )}
            <Card className="flex flex-col gap-2" data-testid="deposit-rule">
              <h2 className="text-lg font-semibold">{t("deposits.rule.title")}</h2>
              {detail.rule === null ? (
                <p className="text-sm text-muted">{t("deposits.rule.none")}</p>
              ) : (
                <>
                  <p className="text-sm">
                    {t("deposits.rule.text", {
                      account:
                        detail.accounts.find((one) => one.id === detail.rule?.accountId)?.name ??
                        t("deposits.rule.anyAccount"),
                      match: detail.rule.payeeMatch,
                      fee:
                        fund.depositFeeCents === null
                          ? t("deposits.rule.noFee")
                          : money(fund.depositFeeCents),
                    })}
                  </p>
                  <p className={cn("text-sm", detail.rule.active ? "text-pos" : "text-muted")}>
                    {detail.rule.active ? t("deposits.rule.active") : t("deposits.rule.paused")}
                  </p>
                </>
              )}
              <Link
                href={`${base}?tab=settings` as Route}
                className="self-start text-sm font-medium text-accent hover:underline"
              >
                {t("deposits.rule.edit")}
              </Link>
            </Card>
          </div>
        </div>
      )}

      {tab === "valuations" && (
        <Card padded={false}>
          <CardHeader
            title={t("valuations.title")}
            actions={
              <span className="text-sm text-muted">
                {t("valuations.hint", { count: detail.valuations.length })}
              </span>
            }
          />
          {detail.valuations.length === 0 ? (
            <p className="px-4 pb-4 text-sm text-muted">{t("valuations.empty")}</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <THead>
                  <Th>{t("valuations.date")}</Th>
                  <Th align="right">{t("valuations.value")}</Th>
                  <Th align="right">{t("valuations.paidIn")}</Th>
                  <Th align="right">{t("valuations.gain")}</Th>
                  <Th align="right">{t("valuations.units")}</Th>
                  <Th>{t("valuations.note")}</Th>
                  <Th>
                    <span className="sr-only">{t("valuations.delete")}</span>
                  </Th>
                </THead>
                <TBody>
                  {detail.valuations.map((row) => (
                    <Tr key={row.id} data-testid="valuation-row">
                      <Td muted>{formatDate(row.on, "long", ctx.locale)}</Td>
                      <Td align="right" className="font-semibold">
                        {money(row.valueCents)}
                      </Td>
                      <Td align="right" muted>
                        {money(row.paidInCents)}
                      </Td>
                      <Td align="right" className={TONE_TEXT[toneOfSign(row.valueCents - row.paidInCents)]}>
                        {signed(row.valueCents - row.paidInCents)}
                      </Td>
                      <Td align="right" muted>
                        {row.units ?? NULL_DISPLAY}
                      </Td>
                      <Td muted className="max-w-[240px] truncate">
                        {row.note ?? ""}
                      </Td>
                      <Td>
                        {!archived && (
                          <DeleteValuation
                            fundId={fund.id}
                            valuationId={row.id}
                            label={t("valuations.delete")}
                            toast={t("toasts.valuationDeleted")}
                          />
                        )}
                      </Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
            </div>
          )}
        </Card>
      )}

      {tab === "settings" && (
        <SettingsGrid>
          <SettingsSection
            title={t("settings.general.title")}
            description={t("settings.plan.description")}
            wide
          >
            <FundSettingsForm
              fundId={fund.id}
              draft={fundDraft(fund, ctx.numberFormat)}
              accounts={detail.accounts}
            />
          </SettingsSection>
          <SettingsSection title={t("settings.rule.title")} description={t("settings.rule.description")}>
            <DepositRuleForm
              fundId={fund.id}
              draft={{
                payeeMatch: detail.rule?.payeeMatch ?? fund.provider ?? "",
                accountId: detail.rule?.accountId ?? fund.debitAccountId ?? "",
                active: detail.rule?.active ?? true,
              }}
              accounts={detail.accounts}
            />
          </SettingsSection>
          <SettingsSection
            title={t("settings.valuations.title")}
            description={t("settings.valuations.description")}
          >
            <Link
              href={`/accounts/${fund.valuationAccountId}?tab=settings` as Route}
              className="self-start font-medium text-accent hover:underline"
            >
              {t("settings.valuations.open", { account: detail.accountName })}
            </Link>
          </SettingsSection>
          <SettingsSection title={t("settings.danger.title")} description={t("settings.danger.description")}>
            <p className="text-sm">{t("settings.danger.text", { name: fund.name })}</p>
            <div>
              {archived ? (
                <FundStateButton
                  fundId={fund.id}
                  state="active"
                  label={t("settings.danger.restore")}
                  toast={t("toasts.restored")}
                />
              ) : (
                <FundStateButton
                  fundId={fund.id}
                  state="archived"
                  label={t("settings.danger.archive")}
                  toast={t("toasts.archived")}
                />
              )}
            </div>
          </SettingsSection>
        </SettingsGrid>
      )}
    </Page>
  );
}
