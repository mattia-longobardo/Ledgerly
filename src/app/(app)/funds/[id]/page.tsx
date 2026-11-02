import type { Metadata } from "next";
import Link from "next/link";
import { notFound, permanentRedirect, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { colorFor } from "@/modules/accounts/ui/display";
import { flowCounts, fundSummary, hypothesesOnly, isFundId, recentFlows } from "@/modules/funds/detail";
import { isFutureYear, valueToday } from "@/modules/funds/home";
import { fundHomeRow } from "@/modules/funds/home-queries";
import { closesPeriodBefore, legacyFundQuery, valuationLines } from "@/modules/funds/tabs";
import { fundDetail } from "@/modules/funds/queries";
import { FundError, requireFund } from "@/modules/funds/service";
import { PacDeposits } from "@/modules/funds/ui/pac-deposits";
import { PensionContributions } from "@/modules/funds/ui/pension-contributions";
import { FundChart } from "@/modules/funds/ui/fund-chart";
import { FundValuations } from "@/modules/funds/ui/fund-valuations";
import { Kpi } from "@/modules/funds/ui/fund-kpi";
import { ValuationButton, FundStateButton } from "@/modules/funds/ui/fund-forms";
import { PacSettings } from "@/modules/funds/ui/pac-settings";
import { ImportCometaButton, PensionSettingsForm } from "@/modules/funds/ui/pension-forms";
import { quarterLabel } from "@/modules/funds/ui/pension-present";
import { PENSION_TABS, PensionSettings } from "@/modules/funds/ui/pension-settings";
import { monthPill } from "@/modules/funds/ui/present";
import { ClosedProjection, ShortProjection } from "@/modules/funds/ui/projection";
import { periodQuery, periodSpan, type Query } from "@/modules/investments/period";
import { periodOf } from "@/modules/investments/pnl";
import { PeriodControl, periodText } from "@/modules/investments/ui/period-control";
import { chargeCandidates } from "@/modules/transactions/queries";
import { requireSession } from "@/platform/auth/session";
import type { Ctx } from "@/platform/context";
import { type CivilDate, today } from "@/platform/dates";
import { formatDate, formatDecimalText, formatMoney, formatPercent, NULL_DISPLAY } from "@/platform/format";
import type { Cents } from "@/platform/money";
import { Badge } from "@/ui/badge";
import { ButtonLink } from "@/ui/button";
import { Card, CardHeader } from "@/ui/card";
import { cn } from "@/ui/cn";
import { Page } from "@/ui/shell/page";
import { EmptyState } from "@/ui/states";
import { TabLinks } from "@/ui/tab-links";
import { TONE_TEXT, toneOfSign } from "@/ui/tone";
import { type Params, withParams } from "@/ui/url";
import { RebuildCompetencesButton } from "../pension-buttons";
import { FundDetailSkeleton } from "./fund-skeleton";

const HOME = "/funds";
const PAC_TABS = ["overview", "deposits", "valuations", "settings"] as const;

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

export async function generateMetadata({ params }: PageProps<"/funds/[id]">): Promise<Metadata> {
  const ctx = await requireSession();
  const { id } = await params;
  if (!isFundId(id)) notFound();
  try {
    return { title: (await requireFund(ctx, id)).name };
  } catch (error) {
    if (error instanceof FundError) notFound();
    throw error;
  }
}

/**
 * A fund's new page (docs/design/funds-ux.md §5.3, §6, F3, mockups a-05 and a-06): the header, the tabs,
 * the period, the Overview of a pension fund or of a PAC, and the tabs that follow the period (F4). The period is in the address and stays from
 * the home to the fund and from a tab to the next. "On the way", the plan, this month's deposit and the
 * projection stay as of today.
 *
 * The skeleton is a boundary of this page and not a `loading.tsx`: a `loading.tsx` here would also cover the
 * fund's documents, and a document that does not exist would answer 200 with a skeleton instead of a real 404.
 * The redirects stay above the boundary, so that they are real redirects.
 */
export default async function FundDetailPage({ params, searchParams }: PageProps<"/funds/[id]">) {
  const ctx = await requireSession();
  const { id } = await params;
  const query = (await searchParams) as Query;
  const todayOn = today(ctx.timeZone);
  const base = `${HOME}/${id}`;

  const legacy = legacyFundQuery(query, todayOn);
  if (legacy) permanentRedirect(withParams(base, {}, legacy));
  if (isFutureYear(one(query.period), todayOn)) {
    const tab = [...PENSION_TABS, ...PAC_TABS].find((name) => name === one(query.tab) && name !== "overview");
    redirect(withParams(base, { tab, view: one(query.view) === "value" ? "value" : undefined }, {}));
  }
  return (
    <Suspense fallback={<FundDetailSkeleton />}>
      <FundDetail ctx={ctx} id={id} query={query} todayOn={todayOn} base={base} />
    </Suspense>
  );
}

async function FundDetail({
  ctx,
  id,
  query,
  todayOn,
  base,
}: {
  ctx: Ctx;
  id: string;
  query: Query;
  todayOn: CivilDate;
  base: string;
}) {
  const t = await getTranslations("funds");
  const th = await getTranslations("funds.home");
  const tf = await getTranslations("funds.fund");
  const tp = await getTranslations("funds.pension");
  const tPeriod = await getTranslations("investments.period");
  const view = one(query.view) === "value" ? "value" : "gain";
  const row = await fundHomeRow(ctx, id);
  const isPension = row.pension !== null;
  const tabs: readonly string[] = isPension ? PENSION_TABS : PAC_TABS;
  const tab = tabs.find((name) => name === one(query.tab)) ?? "overview";
  const kept: Params = {
    tab: tab === "overview" ? undefined : tab,
    view: view === "gain" ? undefined : view,
  };

  const { fund, home } = row;
  const period = periodOf({ period: one(query.period), from: one(query.from), to: one(query.to) }, todayOn);
  const { firstOn, summary, line, beforeFirst } = fundSummary({ fund: home, period, todayOn });
  const span = periodSpan(period, firstOn);
  const periodParams = periodQuery(period, todayOn);
  const name = periodText(period, span, todayOn, ctx.locale, tPeriod);
  const when =
    period.kind === "year"
      ? th("when.year", { year: period.year! })
      : period.kind === "all"
        ? th("when.all")
        : th("when.custom", {
            from: formatDate(span.from, "long", ctx.locale),
            to: formatDate(span.to, "long", ctx.locale),
          });
  const money = (cents: Cents | null, signed = false) => formatMoney(cents, ctx.numberFormat, { signed });
  const percent = (value: number | null) => formatPercent(value, ctx.numberFormat, { signed: true });
  const long = (date: string | null) => formatDate(date, "long", ctx.locale);
  const day = (date: string | null) => formatDate(date, "dayMonth", ctx.locale);
  const tabHref = (name: string) =>
    withParams(base, periodParams, { tab: name === "overview" ? undefined : name });
  const archived = home.archived;
  const pac = isPension ? null : await fundDetail(ctx, id, 12);
  const pension = row.pension;
  const compartment = pension?.compartment ?? fund.compartment;
  const lastLine =
    pac && pac.valuations[0]
      ? t("valuations.form.last", {
          value: money(pac.valuations[0].valueCents),
          date: long(pac.valuations[0].on),
        })
      : null;

  const header = (
    <div className="flex flex-col gap-1">
      <p data-testid="fund-meta" className="text-sm text-muted">
        {[
          isPension ? tp("kind") : t("detail.kind"),
          fund.provider,
          compartment,
          t("detail.since", { date: formatDate(fund.startOn, "monthYear", ctx.locale) }),
        ]
          .filter(Boolean)
          .join(" · ")}
      </p>
      <h1 className="flex flex-wrap items-center gap-2 text-title font-semibold tracking-[-0.02em]">
        {fund.name}
        {archived && <Badge tone="neutral">{th("list.archived")}</Badge>}
      </h1>
    </div>
  );
  const followsPeriod = tab !== "settings";
  const nav = (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <TabLinks
        label={t("detail.tabs.label")}
        tabs={tabs.map((name) => ({
          href: tabHref(name),
          label: tf(`tabs.${name}` as "tabs.overview"),
          active: name === tab,
        }))}
      />
      {followsPeriod && (
        <PeriodControl
          period={period}
          span={span}
          todayOn={todayOn}
          firstOn={firstOn}
          path={base}
          params={kept}
          locale={ctx.locale}
          t={tPeriod}
        />
      )}
    </div>
  );

  const shell = (children: React.ReactNode) => (
    <Page
      title={fund.name}
      parent={{ href: withParams(HOME, {}, periodParams), label: t("title") }}
      actions={
        !archived && (
          <span className="flex gap-2">
            {isPension && <ImportCometaButton fundId={fund.id} label={tp("documents.import")} />}
            <ValuationButton
              fundId={fund.id}
              fundName={fund.name}
              today={todayOn}
              lastLine={lastLine}
              label={tf("recordValue")}
            />
          </span>
        )
      }
    >
      {header}
      {nav}
      {children}
    </Page>
  );

  // ——— Settings, as today (§6): they do not follow the period ———————————————————————————————————
  if (tab === "settings") {
    return shell(
      pension ? (
        <PensionSettings
          ctx={ctx}
          detail={pension}
          today={todayOn}
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
      ) : (
        <PacSettings ctx={ctx} detail={pac!} />
      ),
    );
  }

  // ——— A year before anything there is (§6) ——————————————————————————————————————————————————————
  const { state } = summary;
  const firstYear = firstOn === null ? Number(todayOn.slice(0, 4)) : Number(firstOn.slice(0, 4));
  const yearHref = (year: number) =>
    withParams(base, kept, year === Number(todayOn.slice(0, 4)) ? {} : { period: String(year) });
  if (beforeFirst) {
    return shell(
      <EmptyState
        title={th("noDataTitle", { when })}
        description={th("noDataNote", { date: long(firstOn) })}
        actions={
          <ButtonLink href={yearHref(firstYear)} variant="primary">
            {th("noDataLink", { year: firstYear })}
          </ButtonLink>
        }
      />,
    );
  }

  // ——— The tabs that follow the period (§6): the same lines the Overview reads ——————————————————————
  const movementsOf = async (accountId: string | null) =>
    (
      await chargeCandidates(ctx, {
        accountId,
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
  if (tab === "deposits" && pac) {
    return shell(
      <PacDeposits
        ctx={ctx}
        detail={pac}
        archived={archived}
        period={period}
        when={when}
        todayOn={todayOn}
        movements={await movementsOf(fund.debitAccountId)}
        settingsHref={tabHref("settings")}
      />,
    );
  }
  if (tab === "contributions" && pension) {
    return shell(
      <PensionContributions
        ctx={ctx}
        detail={pension}
        flows={home.flows}
        archived={archived}
        period={period}
        when={when}
        todayOn={todayOn}
        movements={await movementsOf(null)}
      />,
    );
  }
  if (tab === "valuations") {
    const newest = [...home.points].sort((a, b) => (a.on < b.on ? 1 : -1))[0] ?? null;
    return shell(
      <FundValuations
        ctx={ctx}
        fundId={fund.id}
        archived={archived}
        period={period}
        lines={valuationLines(line, period)}
        recorded={pension ? pension.valuations : pac!.valuations}
        valuesEver={home.points.length}
        lastValue={newest}
        notInValueCents={line.measure.notInValueCents}
        when={when}
        todayOn={todayOn}
        pension={pension}
      />,
    );
  }

  // ——— The hero (§6): the same gain and the same return as the fund's row in the home ———————————
  const { measure } = line;
  const measured = line.status === "measured";
  const gainCents = measure.gainCents;
  const noValueYet = !measured && period.to >= todayOn;
  const heroText = measured
    ? money(gainCents, true)
    : noValueYet
      ? th("noValueYet", { when })
      : state === "quiet"
        ? th("noValueIn", { when })
        : th("gainUndetermined");
  const strong = (chunks: React.ReactNode) => (
    <strong className="font-semibold text-fg tabular-nums">{chunks}</strong>
  );
  const heldToday = valueToday([home], todayOn);
  const todayPoint = [...home.points].sort((a, b) => (a.on < b.on ? 1 : -1))[0] ?? null;
  const end = measure.end;
  const past = period.to < todayOn;
  const units = pension?.metrics.units ?? null;
  const lastPrice = pension?.metrics.lastPrice ?? null;
  // Today's value beside a past period's, whatever that period could measure (§6).
  const todayPart =
    past && heldToday !== null && todayPoint ? (
      <span data-testid="fund-value-today">
        {tf("hero.today", { value: money(heldToday), date: day(todayPoint.on) })}
      </span>
    ) : null;
  const lastValue =
    end === null
      ? null
      : th.rich("lastValue", {
          value: money(end.cents),
          dates: th("valuesOn", { date: long(end.on) }),
          strong,
        });
  const valuePart: React.ReactNode =
    end === null ? null : !measured || (archived && !past) ? (
      // An archived fund's old value stays in its gain, but it is not money held today, as in the home.
      lastValue
    ) : past ? (
      period.kind === "year" ? (
        tf.rich("hero.valueAtYearEnd", { value: money(end.cents), date: long(end.on), strong })
      ) : (
        tf.rich("hero.valueAtEnd", {
          end: long(period.to),
          value: money(end.cents),
          date: long(end.on),
          strong,
        })
      )
    ) : (
      <>
        {tf.rich("hero.value", { value: money(end.cents), date: long(end.on), strong })}
        {units !== null &&
          ` · ${tf("hero.units", { units: formatDecimalText(units, ctx.numberFormat, { max: 3 }) })}`}
        {lastPrice &&
          ` · ${tf("hero.unitPrice", {
            price: formatDecimalText(lastPrice.price, ctx.numberFormat, { min: 2, max: 4, currency: "EUR" }),
            date: day(lastPrice.on),
          })}`}
      </>
    );
  const valueLine: React.ReactNode =
    valuePart === null && todayPart === null ? null : (
      <>
        {valuePart}
        {valuePart !== null && todayPart !== null && " · "}
        {todayPart}
      </>
    );
  const firstPaidOn = home.flows
    .filter((flow) => flow.chargedCents > 0n)
    .map((flow) => flow.on)
    .sort()[0] as string | undefined;
  const firstValueOn = home.points.map((point) => point.on).sort()[0] as string | undefined;
  const notes = [
    state === "payslips_only"
      ? firstValueOn
        ? th("payslipsNote", { when, date: long(firstValueOn) })
        : th("payslipsNoValue", { when })
      : null,
    state === "paid_no_value" ? th("paidNote", { when }) : null,
    state === "quiet" ? th("quietNote", { when }) : null,
    !archived && !measured && (state === "paid_no_value" || state === "running_no_value")
      ? th("recordToMeasure", { when })
      : null,
    noValueYet && line.status === "never_valued" && pension && pension.metrics.accruedCents !== 0n
      ? tf("hero.accrued", { amount: money(pension.metrics.accruedCents) })
      : null,
    !measured && end !== null && closesPeriodBefore(end.on, period)
      ? th("closingNote", { date: long(end.on) })
      : null,
    end !== null && measure.notInValueCents > 0n
      ? th("notInValue", { amount: money(measure.notInValueCents) })
      : null,
  ].filter((note) => note !== null);

  const alert =
    row.month.kind === "missing" ? (
      <div
        data-testid="fund-alert"
        className="flex flex-wrap items-center justify-between gap-2 rounded-card border border-neg/30 bg-neg-bg px-3 py-2 text-sm"
      >
        <p>
          {t("alert.missing", {
            date: formatDate(row.month.by, "long", ctx.locale),
            amount: money(fund.monthlyCents),
          })}
        </p>
        <Link
          href="/expenses"
          className="focus-ring inline-flex min-h-6 shrink-0 items-center rounded-[2px] font-medium text-accent hover:underline"
        >
          {t("alert.cta")}
        </Link>
      </div>
    ) : null;

  // ——— On the way, always as of today (§5.3) ————————————————————————————————————————————————————
  const onTheWay =
    row.onTheWay.length > 0 ? (
      <p
        data-testid="fund-on-the-way"
        data-cents={String(row.onTheWayCents)}
        className="rounded-card border border-border bg-card px-3 py-2 text-sm"
      >
        {tp("notice.pending", {
          amount: money(row.onTheWayCents),
          quarters: row.onTheWay
            .map((pending) =>
              tp("notice.pendingQuarter", {
                quarter: quarterLabel(pending.year, pending.quarter),
                amount: money(pending.cents),
                date: long(pending.due),
              }),
            )
            .join("; "),
        })}{" "}
        <Link
          href={tabHref("contributions")}
          className="focus-ring inline-flex min-h-6 items-center rounded-[4px] font-medium text-accent hover:underline"
        >
          {tf("onTheWay.link")}
        </Link>
      </p>
    ) : null;

  // ——— The KPIs (§5.3) ———————————————————————————————————————————————————————————————————————————
  const paidLabel =
    period.kind === "year"
      ? th("kpis.paidInYear", { year: period.year! })
      : period.kind === "all"
        ? th("kpis.paidIn")
        : th("kpis.paidInPeriod");
  const counts = flowCounts(home.flows, period);
  const { origin, deductible } = summary;
  const nothingPaid =
    firstPaidOn && firstPaidOn > period.to
      ? th("kpis.paidInFirst", { date: long(firstPaidOn) })
      : th("kpis.nothingPaid");
  const paidNote =
    measure.paidInCents === 0n
      ? nothingPaid
      : isPension
        ? th(origin.otherCents === 0n ? "kpis.origin" : "kpis.originOther", {
            you: money(origin.youCents),
            employer: money(origin.employerCents),
            tfr: money(origin.tfrCents),
            other: money(origin.otherCents),
          })
        : tf("kpis.deposits", { recurring: counts.recurring, oneOff: counts.oneOff });
  const pill = monthPill(row.month, ctx.locale, {
    found: (date) => t("month.found", { date }),
    awaited: t("month.awaited"),
    missing: t("month.missing"),
    none: t("month.none"),
  });
  const planNote =
    fund.monthlyCents === null
      ? tf("kpis.noPlan")
      : fund.debitDay === null
        ? tf("kpis.planMonth")
        : row.month.kind === "none"
          ? tf("kpis.planDay", { day: fund.debitDay })
          : tf("kpis.planStatus", { day: fund.debitDay, status: pill.text });
  const showDeductible = deductible !== null && period.kind === "year" && state !== "payslips_only";
  const kpis = (
    <div
      className={cn(
        "grid grid-cols-2 gap-4",
        !isPension || showDeductible || state === "payslips_only" ? "@4xl:grid-cols-4" : "@4xl:grid-cols-3",
      )}
    >
      <Kpi testId="kpi-paid" label={paidLabel} value={money(summary.paidInCents)} note={paidNote} />
      <Kpi
        testId="kpi-market"
        label={th("kpis.market")}
        value={summary.marketCents === null ? NULL_DISPLAY : money(summary.marketCents, true)}
        tone={toneOfSign(summary.marketCents)}
        note={summary.marketCents === null ? th("kpis.marketNeedsValue") : th("kpis.marketNote")}
      />
      <Kpi
        testId="kpi-fees"
        label={th("kpis.fees")}
        value={money(-summary.feesCents, summary.feesCents !== 0n)}
        note={
          summary.feesPartial
            ? th("kpis.feesUnknown")
            : summary.paidInCents === 0n && summary.feesCents === 0n
              ? th("kpis.nothingPaid")
              : !isPension && fund.depositFeeCents !== null
                ? tf("kpis.perDeposit", { fee: money(fund.depositFeeCents) })
                : th("kpis.feesNote")
        }
      />
      {showDeductible && (
        <Kpi
          testId="kpi-deductible"
          label={tf("kpis.deductible")}
          value={money(deductible.usedCents)}
          note={
            deductible.usedCents <= deductible.limitCents
              ? tf("kpis.deductibleNote", { limit: money(deductible.limitCents), year: period.year! })
              : tf("kpis.deductibleOver", {
                  limit: money(deductible.limitCents),
                  year: period.year!,
                  over: money(deductible.usedCents - deductible.limitCents),
                })
          }
        />
      )}
      {state === "payslips_only" && (
        <Kpi testId="kpi-accrued" label={th("kpis.accrued")} value={money(summary.accruedCents)} />
      )}
      {!isPension && (
        <Kpi
          testId="kpi-plan"
          label={tf("kpis.plan")}
          value={fund.monthlyCents === null ? NULL_DISPLAY : money(fund.monthlyCents)}
          note={planNote}
        />
      )}
    </div>
  );

  const color = colorFor({ color: row.color }, 0);
  const performance =
    state === "payslips_only" ? (
      <Card data-testid="payslips-only" className="flex flex-col items-start gap-3">
        <h2 className="text-lg font-semibold">{th("chart.empty", { when })}</h2>
        <div className="flex flex-wrap gap-2">
          {period.kind === "year" && firstPaidOn !== undefined && (
            <ButtonLink
              href={yearHref(Math.min(period.year! + 1, Number(todayOn.slice(0, 4))))}
              variant="primary"
              size="sm"
            >
              {th("goToYear", { year: Math.min(period.year! + 1, Number(todayOn.slice(0, 4))) })}
            </ButtonLink>
          )}
          <ButtonLink href={tabHref("contributions")} variant="ghost" size="sm">
            {period.kind === "year" ? th("openContributions", { year: period.year! }) : th("chart.data")}
          </ButtonLink>
        </div>
      </Card>
    ) : (
      <FundChart
        ctx={ctx}
        lines={[line]}
        colorOf={() => color}
        period={period}
        span={span}
        when={when}
        totalCents={gainCents}
        view={view}
        path={base}
        params={periodParams}
        gainNote={(grain) => tf(`chartNote.${grain}`, { when })}
      />
    );

  // ——— The money of the period (§6) —————————————————————————————————————————————————————————————
  const recent = recentFlows(home.flows, period);
  // A label only where a date means one quarter: two quarters credited on one day keep the date.
  const quartersOn = new Map<string, Set<string>>();
  for (const operation of pension?.operations ?? []) {
    if (operation.classification !== "contribution") continue;
    if (operation.competenceYear === null || operation.competenceQuarter === null) continue;
    const labels = quartersOn.get(operation.operationDate) ?? new Set<string>();
    labels.add(quarterLabel(operation.competenceYear, operation.competenceQuarter));
    quartersOn.set(operation.operationDate, labels);
  }
  const quarterOf = (on: string) => {
    const labels = quartersOn.get(on);
    return labels?.size === 1 ? [...labels][0] : null;
  };
  /** Of whom the money is, when the flow says. An exit or a switch says nothing, so neither does its row. */
  const originOf = ({ origin: from }: (typeof recent)[number]) =>
    from.youCents === 0n && from.employerCents === 0n && from.tfrCents === 0n && from.otherCents === 0n
      ? null
      : th(from.otherCents === 0n ? "kpis.origin" : "kpis.originOther", {
          you: money(from.youCents),
          employer: money(from.employerCents),
          tfr: money(from.tfrCents),
          other: money(from.otherCents),
        });
  const recentCard = (
    <Card padded={false} className="min-w-0" data-testid="fund-recent">
      <CardHeader
        title={tf("recent.title")}
        actions={
          <Link
            href={tabHref(isPension ? "contributions" : "deposits")}
            className="focus-ring inline-flex min-h-6 items-center rounded-[2px] text-sm text-accent hover:underline"
          >
            {isPension ? tf("recent.allContributions") : tf("recent.allDeposits")}
          </Link>
        }
      />
      {recent.length === 0 ? (
        <p className="px-4 pb-4 text-sm text-muted">{tf("recent.empty")}</p>
      ) : (
        <ul className="flex flex-col">
          {recent.map((flow, index) => (
            <li
              key={`${flow.on}-${index}`}
              data-testid="recent-flow"
              className="flex items-start justify-between gap-3 border-t border-border px-4 py-2.5"
            >
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="font-medium">{quarterOf(flow.on) ?? day(flow.on)}</span>
                <span className="text-sm text-muted tabular-nums">
                  {isPension
                    ? [quarterOf(flow.on) ? day(flow.on) : null, originOf(flow)].filter(Boolean).join(" · ")
                    : flow.recurring
                      ? tf("recent.sourceRule")
                      : tf("recent.sourceHand")}
                </span>
              </span>
              <span className="flex shrink-0 flex-col items-end gap-0.5 text-right tabular-nums">
                <span className="font-semibold">{money(flow.chargedCents)}</span>
                {flow.feeCents !== null && flow.feeCents !== 0n && (
                  <span className="text-sm text-muted">
                    {tf("recent.fee", { amount: money(-flow.feeCents) })}
                  </span>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );

  const bridgeCard = pension && (
    <Card className="flex min-w-0 flex-col gap-3" data-testid="fund-bridge">
      <h2 className="text-lg font-semibold">{tf("bridge.title")}</h2>
      {pension.bridge === null ? (
        <p className="text-sm text-muted">{tf("bridgeNoValue")}</p>
      ) : (
        <>
          <dl className="flex flex-col gap-1 text-sm">
            {pension.bridge.map((bridgeLine) => (
              <div
                key={bridgeLine.key}
                className={cn(
                  "flex items-baseline justify-between gap-3",
                  bridgeLine.total && "border-t border-border pt-1 font-semibold",
                )}
              >
                <dt>
                  {bridgeLine.key === "value"
                    ? tf("bridgeValue")
                    : tp(`bridge.lines.${bridgeLine.key}` as "bridge.lines.accrued")}
                </dt>
                <dd className="tabular-nums">{money(bridgeLine.cents, !bridgeLine.total)}</dd>
              </div>
            ))}
          </dl>
          <p className="text-sm text-muted">
            {tf("bridge.note", { date: long(pension.metrics.value?.on ?? null) })}
          </p>
        </>
      )}
    </Card>
  );

  return shell(
    <>
      {alert}
      <section aria-labelledby="fund-gain" className="flex min-w-0 flex-col gap-1">
        <h2 id="fund-gain" className="text-sm font-medium text-muted">
          {th("gainTitle", { period: name })}
        </h2>
        <p
          data-testid="funds-hero"
          data-state={state}
          data-cents={gainCents === null ? "" : String(gainCents)}
          className="flex flex-wrap items-baseline gap-x-3"
        >
          <span
            className={cn(
              "text-[2rem] leading-tight font-semibold tracking-[-0.02em] tabular-nums",
              TONE_TEXT[toneOfSign(gainCents)],
            )}
          >
            {heroText}
          </span>
          {measure.rate !== null && (
            <span
              data-testid="funds-rate"
              title={
                measure.xirr?.status === "ok"
                  ? th("list.xirr", { rate: percent(measure.xirr.rate) })
                  : undefined
              }
              className={cn("text-lg font-semibold tabular-nums", TONE_TEXT[toneOfSign(measure.rate)])}
            >
              {percent(measure.rate)}
            </span>
          )}
        </p>
        {valueLine && (
          <p data-testid="fund-value" className="text-sm text-muted">
            {valueLine}
          </p>
        )}
        {notes.map((note) => (
          <p key={note} className="text-sm text-muted">
            {note}
          </p>
        ))}
        {(noValueYet || (!measured && state === "paid_no_value")) && !archived && (
          <div className="pt-1">
            <ValuationButton
              fundId={fund.id}
              fundName={fund.name}
              today={todayOn}
              lastLine={lastLine}
              label={line.status === "never_valued" ? th("list.first") : tf("recordValue")}
              place="card"
            />
          </div>
        )}
      </section>
      {onTheWay}
      {kpis}
      {performance}
      <div className="grid min-w-0 items-start gap-4 @4xl:grid-cols-2">
        {recentCard}
        {pension ? (
          bridgeCard
        ) : (
          <ShortProjection
            ctx={ctx}
            forecast={hypothesesOnly(pac!.forecast)}
            plan={fund.state === "active" && fund.monthlyCents !== null}
          />
        )}
      </div>
      {pension && <ClosedProjection ctx={ctx} forecast={hypothesesOnly(pension.forecast)} />}
    </>,
  );
}

export const dynamic = "force-dynamic";
