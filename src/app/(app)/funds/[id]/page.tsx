import type { Metadata, Route } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { LinkTabs } from "@/modules/accounts/ui/controls";
import { asNumbers, axisLabels, monthLabels } from "@/modules/accounts/ui/display";
import { pensionDetail } from "@/modules/funds/pension/queries";
import { fundDetail } from "@/modules/funds/queries";
import { FundError } from "@/modules/funds/service";
import { MonthRangePicker } from "@/modules/accounts/ui/month-range-picker";
import { monthRange } from "@/modules/accounts/ui/range";
import { DetectRuleButton } from "@/modules/funds/ui/detect-rule";
import { ForecastCard } from "@/modules/funds/ui/forecast-card";
import { ReturnsCard } from "@/modules/funds/ui/returns-card";
import { ImportCometaButton, PensionSettingsForm } from "@/modules/funds/ui/pension-forms";
import { PENSION_TABS, type PensionTab, PensionView } from "@/modules/funds/ui/pension-view";
import { chargeCandidates } from "@/modules/transactions/queries";
import { RebuildCompetencesButton } from "../pension-buttons";
import {
  AddDepositCard,
  DeleteDeposit,
  DeleteValuation,
  DepositRuleForm,
  EditDepositButton,
  EditValuationButton,
  FundSettingsForm,
  FundStateButton,
  ValuationButton,
} from "@/modules/funds/ui/fund-forms";
import { depositDraft, fundDraft, newDepositDraft, valuationDraft } from "@/modules/funds/ui/present";
import { formatRate } from "@/modules/interests/ui/present";
import { requireSession } from "@/platform/auth/session";
import { monthKey, monthsBetween, today } from "@/platform/dates";
import { formatDate, formatMoney, formatPercent, NULL_DISPLAY } from "@/platform/format";
import { Card, CardHeader } from "@/ui/card";
import { MultiLine } from "@/ui/chart";
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
  const ctx = await requireSession();
  const { id } = await params;
  try {
    const [fund] = await Promise.all([fundDetail(ctx, id, 12)]);
    return { title: fund.fund.name };
  } catch (error) {
    if (error instanceof FundError) notFound();
    throw error;
  }
}

/**
 * The pension side of Fund detail (spec §7.7, plan F6 L5): its own tabs and its own figures, on
 * the same page and the same shell as a PAC's.
 */
async function PensionPage({
  id,
  query,
}: {
  id: string;
  query: Awaited<PageProps<"/funds/[id]">["searchParams"]>;
}) {
  const ctx = await requireSession();
  const t = await getTranslations("funds");
  const tp = await getTranslations("funds.pension");
  const detail = await pensionDetail(ctx, id);
  const tab = (PENSION_TABS.find((one) => one === query.tab) ?? "overview") as PensionTab;
  const span = ["12", "24", "60"].find((one) => one === query.span) ?? "24";
  const todayOn = today(ctx.timeZone);
  /*
    What the chart draws. A range written by the picker wins over the preset and is drawn whole,
    month by month, even where the fund has nothing to show: asking for a window and being given
    another one is worse than an empty stretch (owner, 2026-09-20).
  */
  const custom = monthRange(query, monthKey(todayOn));
  const known = new Map(detail.chart.months.map((month, index) => [month, index]));
  const windowMonths = custom
    ? monthsBetween(custom.from, custom.to)
    : detail.chart.months.slice(-Number(span));
  const window = {
    months: windowMonths,
    value: windowMonths.map((month) => {
      const at = known.get(month);
      return at === undefined ? null : detail.chart.value[at];
    }),
    paidIn: windowMonths.map((month) => {
      const at = known.get(month);
      return at === undefined ? null : detail.chart.paidIn[at];
    }),
  };
  const { fund, metrics } = detail;
  const base = `/funds/${fund.id}`;
  const money = (cents: bigint | null) =>
    cents === null ? NULL_DISPLAY : formatMoney(cents, ctx.numberFormat);
  const movements = (
    await chargeCandidates(ctx, {
      accountId: null,
      from: fund.startOn,
      to: todayOn,
      types: ["expense", "transfer"],
    })
  )
    .slice(0, 50)
    .map((candidate) => ({
      id: candidate.id,
      label: `${formatDate(candidate.on, "dayMonth", ctx.locale)} · ${candidate.payee ?? ""} · ${money(candidate.cents)}`,
    }));
  const archived = fund.state === "archived";
  // No document has valued the fund yet, but the payslips have: the hero says what they accrued,
  // under its own label, rather than "No valuation yet" over an empty page (owner, 2026-09-20).
  // A documented value always wins it back.
  const showsAccrued = metrics.value === null && metrics.accruedCents !== 0n;

  return (
    <Page
      title={fund.name}
      parent={{ href: "/funds", label: t("title") }}
      actions={
        !archived && (
          <span className="flex gap-2">
            <ImportCometaButton fundId={fund.id} label={tp("documents.import")} />
            <ValuationButton
              fundId={fund.id}
              fundName={fund.name}
              today={todayOn}
              lastLine={null}
              label={t("table.valuation")}
            />
          </span>
        )
      }
    >
      <div className="flex flex-col gap-1">
        <p className="text-sm text-muted">
          {[
            tp("kind"),
            fund.provider,
            fund.compartment,
            t("detail.since", { date: formatDate(fund.startOn, "monthYear", ctx.locale) }),
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
        <h1 className="text-title font-semibold tracking-[-0.02em]">{fund.name}</h1>
        <p className="text-hero font-semibold tracking-[-0.02em] tabular-nums">
          {metrics.value !== null
            ? money(metrics.value.cents)
            : showsAccrued
              ? money(metrics.accruedCents)
              : t("detail.noValue")}
        </p>
        {showsAccrued ? (
          <p className="text-sm font-medium">{tp("header.accrued")}</p>
        ) : (
          <p className="flex flex-wrap gap-x-2 text-sm">
            <span className={cn("font-medium", TONE_TEXT[toneOfSign(metrics.gainCents)])}>
              {metrics.gainCents === null
                ? NULL_DISPLAY
                : formatMoney(metrics.gainCents, ctx.numberFormat, { signed: true })}{" "}
              · {formatPercent(metrics.gainFraction, ctx.numberFormat, { signed: true })}{" "}
              {tp("notAnnualised")}
            </span>
            <span className="text-muted">
              {tp("header.paidIn", {
                // The paid-in the gain beside it was measured against, never a different one.
                paidIn: money(metrics.gainBasisCents),
                date: metrics.value ? formatDate(metrics.value.on, "long", ctx.locale) : NULL_DISPLAY,
              })}
            </span>
          </p>
        )}
      </div>

      <TabLinks
        label={t("detail.tabs.label")}
        tabs={PENSION_TABS.map((one) => ({
          href: (one === "overview" ? base : `${base}?tab=${one}`) as Route,
          label: tp(`tabs.${one}`),
          active: one === tab,
        }))}
      />

      <PensionView
        ctx={ctx}
        detail={detail}
        tab={tab}
        span={span}
        window={window}
        rangePicker={
          windowMonths.length > 0 && (
            <MonthRangePicker
              from={windowMonths[0]}
              to={windowMonths[windowMonths.length - 1]}
              path={base}
              params={{ tab, span: custom ? undefined : span }}
              locale={ctx.locale}
            />
          )
        }
        movements={movements}
        rebuild={<RebuildCompetencesButton fundId={fund.id} label={tp("settings.rebuild")} />}
        settingsForm={
          <PensionSettingsForm
            fundId={fund.id}
            draft={{
              name: fund.name,
              provider: fund.provider ?? "",
              compartment: fund.compartment ?? "",
              startOn: fund.startOn,
            }}
          />
        }
        valuationButton={
          !archived && (
            <ValuationButton
              fundId={fund.id}
              fundName={fund.name}
              today={todayOn}
              lastLine={null}
              label={t("table.valuation")}
              place="card"
            />
          )
        }
        archiveButton={
          archived ? (
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
          )
        }
      />
    </Page>
  );
}

/** Fund detail (spec §7.7, design): Overview · Deposits · Valuations · Settings of a PAC. */
export default async function FundPage({ params, searchParams }: PageProps<"/funds/[id]">) {
  const { id } = await params;
  const query = await searchParams;
  const ctx0 = await requireSession();
  let kind: "pac" | "pension";
  try {
    kind = (await fundDetail(ctx0, id, 12)).fund.type;
  } catch (error) {
    if (error instanceof FundError) notFound();
    throw error;
  }
  if (kind === "pension") return <PensionPage id={id} query={query} />;
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
  /** The fund's own debits, newest first: what "Find this charge everywhere" starts from. */
  const pacMovements = (
    await chargeCandidates(ctx, {
      accountId: fund.debitAccountId,
      from: fund.startOn,
      to: todayOn,
      types: ["expense", "transfer"],
    })
  )
    .slice(-60)
    .reverse()
    .map((candidate) => ({
      id: candidate.id,
      label: `${formatDate(candidate.on, "dayMonth", ctx.locale)} · ${candidate.payee ?? ""} · ${money(candidate.cents)}`,
    }));

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
          <Th align="right">
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
              <Td align="right">
                {!archived && (
                  <span className="flex justify-end gap-1">
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
              {/* The paid-in the gain beside it was measured against — the deposits the valuation
                  could see — never the whole of it (owner, 2026-09-20). */}
              {t("detail.asOf", {
                paidIn: money(metrics.gainBasisCents),
                date: formatDate(lastValuation.on, "long", ctx.locale),
              })}
            </span>
          )}
          {metrics.paidInAfterValueCents > 0n && (
            <span className="text-faint">
              {t("detail.afterValue", { amount: money(metrics.paidInAfterValueCents) })}
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

          <div className="grid min-w-0 items-start gap-4 @4xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
            <ReturnsCard
              ctx={ctx}
              periods={detail.periods}
              stats={detail.stats}
              href={`${base}/returns` as Route}
            />
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

          <ForecastCard ctx={ctx} forecast={detail.forecast} />
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
              <span className="flex flex-wrap items-center gap-3">
                <Link
                  href={`${base}?tab=settings` as Route}
                  className="inline-flex h-6 items-center text-sm font-medium text-accent hover:underline"
                >
                  {t("deposits.rule.edit")}
                </Link>
                {/* The rule without typing it: one charge names the rest (owner, 2026-09-20). */}
                {!archived && (
                  <DetectRuleButton
                    fundId={fund.id}
                    movements={pacMovements}
                    accountId={fund.debitAccountId ?? ""}
                    format={ctx.numberFormat}
                    locale={ctx.locale}
                    label={t("detect.button")}
                  />
                )}
              </span>
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
                  <Th>{t("valuations.note")}</Th>
                  <Th align="right">
                    <span className="sr-only">{t("valuations.edit")}</span>
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
                      <Td muted className="max-w-[240px] truncate">
                        {row.note ?? ""}
                      </Td>
                      <Td align="right">
                        {!archived && (
                          <span className="flex justify-end gap-1">
                            <EditValuationButton
                              fundId={fund.id}
                              draft={valuationDraft(row, ctx.numberFormat)}
                              today={todayOn}
                              label={t("valuations.edit")}
                            />
                            <DeleteValuation
                              fundId={fund.id}
                              valuationId={row.id}
                              label={t("valuations.delete")}
                              toast={t("toasts.valuationDeleted")}
                            />
                          </span>
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
          <SettingsSection title={t("settings.general.title")} description={t("settings.plan.description")}>
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
              className="inline-flex h-6 items-center self-start font-medium text-accent hover:underline"
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
