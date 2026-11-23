// R3 parity of the reads of Funds: every field the routes added for the pages is the figure the page
// shows today, computed here as the page computes it (the lines of `app/(app)/funds/page.tsx`,
// `[id]/page.tsx` and the tabs, copied), on the two funds of the reference (B3) and a few more rows —
// units and a statement, an archived fund, an expired fee, two movements —, for «all», a year and a
// custom period.
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { pensionCompetences } from "@domain/modules/funds/schema";
import type { Ctx } from "@domain/platform/context";
import { getDb } from "@domain/platform/db/client";
import { feeValidOn } from "@domain/shared/fees";
import { closeDatabase, resetDatabase } from "../../../../../test/db";
import { anAccount, movement, newContext } from "../../../../../test/fixtures";
import { addVoluntaryContribution, importedOperation, importedPosition } from "../../../../../test/funds";
import { seedFundsReference } from "../../../../../test/funds-reference";

vi.mock("next/server", () => ({ after: () => {} }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

const { adapters } = await import("@/app/api/v1/[[...route]]/composition");
const { apiRoutes } = await import("@ledgerly/api");
const funds = await import("@ledgerly/domain/funds");
const { arrangeFees } = await import("@ledgerly/domain/funds/client");
const { legacyPeriodQuery, periodSpan, sectionPeriod } = await import("@ledgerly/domain/investments");
const { chargeCandidates } = await import("@ledgerly/domain/transactions");
const { upsertFromProvider } = await import("@domain/modules/transactions/service");
const { centsToDecimal } = await import("@ledgerly/domain/shared/money");
const { asReturns, bestAndWorst, returnScale, runningTotal } = await import("@ledgerly/ui/chart-data");
const { WALLET_PROVIDER } = await import("../../../../../test/fixtures/providers");

type Cents = bigint;
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the answers are read as JSON
type Json = any;

const NOW = new Date("2031-10-15T10:00:00Z");
const TODAY = "2031-10-15";
const PERIODS = [
  { period: "all" },
  { period: "2031" },
  { period: "custom", from: "2031-02-01", to: "2031-08-31" },
] as const;

let ctx: Ctx;
let ids: { debitId: string; payslipId: string; archivedId: string; accountId: string };

const routes = apiRoutes({
  ...adapters,
  guard: () => async (context, next) => {
    context.set("ctx", ctx);
    await next();
  },
});

async function get(path: string): Promise<Json> {
  const response = await routes.request(path);
  expect(response.status, path).toBe(200);
  return response.json();
}

const dec = (cents: Cents | null | undefined) =>
  cents === null || cents === undefined ? null : centsToDecimal(cents);
const query = (one: (typeof PERIODS)[number]) => new URLSearchParams(one).toString();
/** The period the page measures: an address of the routes is first sent where the page reads it. */
const pagePeriod = (one: (typeof PERIODS)[number]) =>
  sectionPeriod(legacyPeriodQuery(one as Json, TODAY) ?? (one as Json), TODAY).period;
const byId = <T extends { id?: string; fundId?: string }>(rows: readonly T[]) =>
  new Map(rows.map((row) => [row.id ?? row.fundId, row]));

beforeAll(async () => {
  await resetDatabase();
  ctx = await (async () => {
    const made = await newContext();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    return made;
  })();
  const { debitId, payslipId } = await seedFundsReference(ctx);
  // Units and a statement on the payslip fund; an expired fee on the debit fund.
  await importedOperation(ctx, payslipId, {
    originKey: "parity-1",
    originalType: "contribution",
    classification: "contribution",
    competenceYear: 2031,
    competenceQuarter: 3,
    operationDate: "2031-10-10",
    workerCents: 1_000n,
    netCents: 1_000n,
    movements: [
      { compartment: "Bilanciata", units: "10.125", unitPrice: "12.3456", unitPriceDate: "2031-10-10" },
    ],
  });
  await importedPosition(ctx, await funds.requireFund(ctx, payslipId), {
    valuationDate: "2031-06-30",
    valueCents: 265_900n,
    workerCents: 70_000n,
    inflowsCents: 1_000n,
    reportedGainCents: 2_500n,
  });
  await funds.addFee(ctx, debitId, {
    label: "Old fee",
    basis: "periodic",
    amountCents: 500n,
    rate: null,
    period: "year",
    sourceId: null,
    component: null,
    validFrom: "2030-01-01",
    validTo: "2030-12-31",
    note: null,
  });
  // An archived fund, paid by hand and valued.
  const archived = await funds.createFund(ctx, {
    fund: { name: "Fondo Gamma", provider: null, compartment: null, startOn: "2031-01-01" },
    currency: "EUR",
    sources: [{ kind: "manual" }],
    fees: [],
  });
  await addVoluntaryContribution(ctx, archived.id, { on: "2031-02-10", amountCents: 10_000n });
  await funds.recordValuation(ctx, archived.id, {
    on: "2031-03-31",
    cents: 10_100n,
    units: null,
    note: null,
  });
  await funds.setFundState(ctx, archived.id, "archived");
  // Two movements out of an account, for the selector.
  const accountId = await anAccount(ctx);
  await upsertFromProvider(
    ctx,
    accountId,
    [
      movement({ externalId: "p-1", occurredAt: new Date("2031-09-05T09:00:00Z"), amountCents: -25_100n }),
      movement({ externalId: "p-2", occurredAt: new Date("2031-10-05T09:00:00Z"), amountCents: -25_100n }),
    ],
    { provider: WALLET_PROVIDER, now: NOW },
  );
  // A month with no payslip: its period answers it in `missingMonths` (the 500 of v0.54.0).
  await getDb()
    .delete(pensionCompetences)
    .where(and(eq(pensionCompetences.fundId, payslipId), eq(pensionCompetences.payrollPeriod, "2031-05-01")));
  ids = { debitId, payslipId, archivedId: archived.id, accountId };
}, 120_000);

afterAll(async () => {
  vi.useRealTimers();
  await resetDatabase();
  await closeDatabase();
});

/** The gain chart as `FundChart` reads it: the running total, the extremes and the Return view. */
function expectChart(
  gain: Json,
  lines: Parameters<typeof funds.gainBars>[0],
  period: Json,
  firstOn: string | null,
  header: { total: Cents | null; rate: number | null },
) {
  const span = periodSpan(period, firstOn);
  const bars = funds.gainBars(lines, span, funds.gainGrain(period, span));
  const totals = bars.map((bar) => bar.totalCents);
  const cumulative = runningTotal(totals);
  const extremes = bestAndWorst(totals);
  const scale = returnScale(header.total, header.rate);
  const shares = scale === null ? totals.map(() => null) : asReturns(totals, scale);
  const cumulativeShares = scale === null ? totals.map(() => null) : asReturns(cumulative, scale);
  expect(gain.best).toBe(extremes?.best ?? null);
  expect(gain.worst).toBe(extremes?.worst ?? null);
  bars.forEach((bar, index) => {
    const out = gain.bars[index];
    expect(out.cumulative).toBe(dec(cumulative[index]));
    expect(out.share).toBe(shares[index]);
    expect(out.cumulativeShare).toBe(cumulativeShares[index]);
    const sort = (rows: Json[]) =>
      [...rows].sort((left, right) => (left.fundId + left.from < right.fundId + right.from ? -1 : 1));
    expect(sort(out.stretches)).toEqual(
      sort(
        bar.stretches.map((one) => ({
          fundId: one.fundId,
          from: one.from,
          to: one.to,
          gain: dec(one.gainCents),
          share: scale === null ? null : asReturns([one.gainCents], scale)[0],
        })),
      ),
    );
    for (const [fundId, cents] of bar.byFund) {
      expect(out.funds.find((one: Json) => one.fundId === fundId).share).toBe(
        scale === null ? null : asReturns([cents], scale)[0],
      );
    }
  });
}

/** What the sources say as of today, as the home's row and the Overview read the row. */
function expectAsOfToday(out: Json, row: Awaited<ReturnType<typeof funds.fundHomeRow>>) {
  const debit = row.detail.debits.find((one) => one.source.state === "active") ?? null;
  expect(out.hasCalendar).toBe(funds.hasPayrollCalendar(row.detail));
  expect(out.onTheWay.amount).toBe(dec(row.onTheWayCents));
  expect(out.onTheWay.periods).toHaveLength(row.onTheWayQuarters);
  expect(out.onTheWay.periods.map((one: Json) => [one.year, one.index, one.amount, one.due])).toEqual(
    row.onTheWay.map((one) => [one.year, one.quarter, dec(one.cents), one.due]),
  );
  if (debit === null) return expect(out.debit).toBeNull();
  expect(out.debit).toMatchObject({
    sourceId: debit.source.id,
    amount: dec(debit.source.amountCents),
    frequency: debit.plan.frequency,
    day: debit.plan.day,
    status: debit.status.kind,
    on: debit.status.kind === "found" ? debit.status.on : null,
    by: debit.status.kind === "missing" ? debit.status.by : null,
  });
}

describe("GET /funds, against the home page", () => {
  it.each(PERIODS)("gives the page's figures for %o", async (one) => {
    const answer = await get(`/funds?${query(one)}`);
    const rows = await funds.fundsHomeRows(ctx, NOW);
    const homes = rows.map((row) => row.home);
    const firstOn = funds.firstDataOn(homes);
    const period = pagePeriod(one);
    const span = periodSpan(period, firstOn);
    const summary = funds.homeSummary({ funds: homes, period, todayOn: TODAY, firstOn });
    const rowOf = new Map(rows.map((row) => [row.fund.id, row]));
    const open = rows.filter((row) => !row.home.archived);
    const inPeriodOf = (fundId: string) =>
      rowOf.get(fundId)!.detail.operations.filter((op) => funds.inPeriod(op.operationDate, period));
    const voluntary = summary.lines.reduce<Cents>(
      (sum, line) => sum + funds.voluntaryCents(inPeriodOf(line.fund.id)),
      0n,
    );
    expect(answer.summary.origin.voluntary).toBe(dec(voluntary));
    expect(answer.onTheWay).toBe(dec(open.reduce<Cents>((sum, row) => sum + row.onTheWayCents, 0n)));
    expect(answer.awaitsPayslips).toBe(open.some((row) => funds.hasPayrollCalendar(row.detail)));
    expect(answer.firstValueOn).toBe(
      homes.flatMap((fund) => fund.points.map((point) => point.on)).sort()[0] ?? null,
    );
    expect(answer.firstPaidOn).toBe(
      homes
        .flatMap((fund) => fund.flows.filter((flow) => flow.chargedCents > 0n).map((flow) => flow.on))
        .sort()[0] ?? null,
    );
    const accruedFund = summary.lines.find((line) => line.accruedCents !== 0n)?.fund ?? null;
    const accruedDue = accruedFund?.accrued
      .filter((line) => line.on >= span.from && line.on <= span.to)
      .map((line) => line.dueOn)
      .filter((due) => due !== null)
      .sort()
      .at(-1);
    expect(answer.accrued).toEqual(
      accruedFund === null ? null : { fundId: accruedFund.id, dueOn: accruedDue ?? null },
    );
    expect(answer.valuesSeen).toBe(
      summary.lines.filter((line) => funds.lineValue(line, period, TODAY) !== null).length,
    );
    const stale = new Map(
      funds
        .staleFunds(
          open.map((row) => row.home),
          TODAY,
        )
        .map((row) => [row.fund.id, row.lastOn]),
    );
    expect(answer.period.span).toEqual(span);
    expect(answer.summary.valueToClosesPrevious).toBe(
      summary.valueTo !== null && funds.closesPeriodBefore(summary.valueTo, period),
    );
    // «Who paid in», as the page draws it.
    const paidTotal = summary.paidInCents;
    expect(answer.summary.originShares).toEqual(
      funds
        .originParts(summary.origin, voluntary)
        .filter((part) => part.cents > 0n)
        .map((part) => ({
          key: part.key,
          amount: dec(part.cents),
          share: paidTotal > 0n ? Number(part.cents) / Number(paidTotal) : 0,
        })),
    );
    for (const fund of answer.funds) {
      const row = rowOf.get(fund.id)!;
      expectAsOfToday(fund, row);
      if (stale.has(fund.id)) expect(fund.lastValueOn).toBe(stale.get(fund.id));
      const line = summary.lines.find((each) => each.fund.id === fund.id);
      if (line === undefined) continue;
      expect(fund.line.value).toBe(dec(funds.lineValue(line, period, TODAY)));
      const end = line.measure.end;
      expect(fund.line.endClosesPrevious).toBe(end !== null && funds.closesPeriodBefore(end.on, period));
      expect(fund.line.origin.voluntary).toBe(dec(funds.voluntaryCents(inPeriodOf(fund.id))));
    }
    expectChart(answer.gain, summary.lines, period, firstOn, {
      total: summary.gainCents,
      rate: summary.rate,
    });
  });
});

describe("GET /funds/{id}, against the Overview", () => {
  it.each(PERIODS)("gives the page's figures for %o", async (one) => {
    for (const id of Object.values(ids).slice(0, 3)) {
      const answer = await get(`/funds/${id}?${query(one)}`);
      const row = await funds.fundHomeRow(ctx, id, NOW);
      const { detail, home } = row;
      const period = pagePeriod(one);
      const { firstOn, line } = funds.fundSummary({ fund: home, period, todayOn: TODAY });
      expect(answer.period.span).toEqual(periodSpan(period, firstOn));
      expect(answer.accrualPeriod).toBe(detail.payroll?.period ?? null);
      const end = line.measure.end;
      expect(answer.line.endClosesPrevious).toBe(end !== null && funds.closesPeriodBefore(end.on, period));
      const operations = detail.operations.filter((operation) =>
        funds.inPeriod(operation.operationDate, period),
      );
      const hasUnits = detail.movements.length > 0;
      const debit = detail.debits.find((each) => each.source.state === "active") ?? null;
      const short = debit !== null && detail.payroll === null;
      expect(answer.valueTodayOn).toBe(
        [...home.points].sort((a, b) => (a.on < b.on ? 1 : -1))[0]?.on ?? null,
      );
      expect(answer.firstPaidOn).toBe(
        home.flows
          .filter((flow) => flow.chargedCents > 0n)
          .map((flow) => flow.on)
          .sort()[0] ?? null,
      );
      expect(answer.firstValueOn).toBe(home.points.map((point) => point.on).sort()[0] ?? null);
      expect(answer.units).toBe(hasUnits ? detail.metrics.units : null);
      expect(answer.lastPrice).toEqual(hasUnits ? detail.metrics.lastPrice : null);
      expect(answer.bridge).toEqual(
        detail.payroll === null
          ? null
          : {
              lines:
                detail.bridge?.map((each) => ({
                  key: each.key,
                  amount: dec(each.cents),
                  total: each.total === true,
                })) ?? null,
              on: detail.metrics.value?.on ?? null,
            },
      );
      expect(answer.line.origin.voluntary).toBe(dec(funds.voluntaryCents(operations)));
      expect(answer.recent.map((each: Json) => [each.id, each.gross, each.origin])).toEqual(
        operations
          .filter((each) => funds.operationGross(each) !== 0n)
          .reverse()
          .slice(0, 5)
          .map((each) => [
            each.id,
            dec(funds.operationGross(each)),
            funds.operationOrigin(each, detail.sources),
          ]),
      );
      expect([answer.operationsEver, answer.competencesEver, answer.valuesEver]).toEqual([
        detail.operations.length,
        detail.competences.length,
        home.points.length,
      ]);
      expect(answer.forecast.layout).toBe(short ? "short" : "closed");
      expect(answer.forecast.basis).toBe(
        short && row.fund.state === "active" && debit.source.amountCents !== null ? "plan" : "average",
      );
      expectAsOfToday(answer, row);
      expectChart(answer.gain, [line], period, firstOn, {
        total: line.measure.gainCents,
        rate: line.measure.rate,
      });
    }
  });
});

describe("GET /funds/{id}/contributions, against the tab", () => {
  it.each(PERIODS)("gives the tab's figures for %o", async (one) => {
    for (const id of Object.values(ids).slice(0, 3)) {
      const answer = await get(`/funds/${id}/contributions?${query(one)}`);
      const row = await funds.fundHomeRow(ctx, id, NOW);
      const { detail } = row;
      const period = pagePeriod(one);
      const summed = funds.fundSummary({ fund: row.home, period, todayOn: TODAY });
      expect(answer.beforeFirst).toBe(summed.beforeFirst);
      expect(answer.period.span).toEqual(periodSpan(period, summed.firstOn));
      if (detail.payroll !== null) {
        const touched = detail.quarters.filter((quarter) =>
          funds.quarterInPeriod(quarter, period, detail.payroll!.period),
        );
        expect(answer.payroll.periods.map((each: Json) => each.missingMonths)).toEqual(
          touched.map((quarter) => quarter.missingMonths),
        );
      }
      const rows = detail.operations.filter((each) => funds.inPeriod(each.operationDate, period));
      const add = <T>(list: readonly T[], pick: (each: T) => Cents | null) =>
        list.reduce<Cents>((sum, each) => sum + (pick(each) ?? 0n), 0n);
      const voluntary = (each: (typeof rows)[number]) => each.classification === "voluntary";
      const part = (each: (typeof rows)[number], cents: Cents) => (voluntary(each) ? null : cents);
      expect(answer.totals).toEqual({
        worker: dec(add(rows, (each) => part(each, each.workerCents))),
        employer: dec(add(rows, (each) => part(each, each.employerCents))),
        tfr: dec(add(rows, (each) => part(each, each.tfrCents))),
        voluntary: dec(add(rows, (each) => (voluntary(each) ? each.workerCents : null))),
        other: dec(
          add(rows, (each) => (each.classification === "withdrawal" ? -each.otherCents : each.otherCents)),
        ),
        fees: dec(add(rows, (each) => each.feesCents)),
        net: dec(add(rows, (each) => each.netCents)),
      });
      expect(answer.operations.map((each: Json) => [each.gross, each.origin])).toEqual(
        rows.map((each) => [dec(funds.operationGross(each)), funds.operationOrigin(each, detail.sources)]),
      );
      expect(answer.operationsEver).toBe(detail.operations.length);
      expect(answer.fedBySources).toBe(detail.sources.some((source) => source.kind !== "manual"));
      const months = detail.months.filter(({ competence }) =>
        funds.inPeriod(funds.competenceOn(competence), period),
      );
      const total = (competence: (typeof months)[number]["competence"]) =>
        (competence.workerCents ?? 0n) + (competence.employerCents ?? 0n) + (competence.tfrCents ?? 0n);
      expect(
        answer.payslips.map((each: Json) => [each.competenceId, each.index, each.total, each.status]),
      ).toEqual(
        months.map(({ competence, quarter }) => [
          competence.id,
          funds.competencePeriod(competence, detail.payroll?.period ?? "quarter"),
          dec(total(competence)),
          quarter?.status ?? null,
        ]),
      );
      expect(answer.payslipTotals.total).toBe(dec(add(months, (each) => total(each.competence))));
      expect(answer.payslipTotals.tfr).toBe(dec(add(months, (each) => each.competence.tfrCents)));
      expect(answer.debits.map((each: Json) => each.sourceId)).toEqual(
        detail.debits.map((each) => each.source.id),
      );
      if (detail.payroll !== null) {
        expect(answer.payroll.toleranceDays).toBe(detail.payroll.toleranceDays);
        const touched = detail.quarters.filter((quarter) =>
          funds.quarterInPeriod(quarter, period, detail.payroll!.period),
        );
        expect(answer.payroll.periods.map((each: Json) => each.lastCreditedOn)).toEqual(
          touched.map((quarter) => quarter.operationDates.at(-1) ?? null),
        );
      }
      expect(answer.setup).toEqual(row.fund.state === "archived" ? null : oldSetup(detail));
    }
  });
});

/** «Record contribution» as `contributionSetup` worked it out before this release, line for line. */
function oldSetup(detail: Awaited<ReturnType<typeof funds.fundHomeRow>>["detail"]) {
  const ANY_AMOUNT = 1_000_000_000_000n;
  const { fund, payroll, sources, fees } = detail;
  const amounts = fees.filter((fee) => fee.rate === null);
  const debit = sources.find((source) => source.kind === "bank_debit" && source.state === "active");
  const byHand = debit ?? sources.find((source) => source.kind === "manual") ?? null;
  const voluntaryFee =
    funds.contributionFee(amounts, { on: TODAY, chargedCents: ANY_AMOUNT, sourceId: byHand?.id ?? null }) ??
    0n;
  const payrollFee =
    payroll === null
      ? 0n
      : (funds.contributionFee(amounts, {
          on: TODAY,
          chargedCents: ANY_AMOUNT,
          sourceId: payroll.source.id,
        }) ?? 0n) +
        funds.periodFees(fees, { sourceId: payroll.source.id, period: payroll.period, on: TODAY })
          .quarterCents;
  const periods: { year: number; index: number }[] = [];
  if (payroll !== null) {
    const firstYear = Math.min(
      Number(fund.startOn.slice(0, 4)),
      ...detail.competences.map((competence) => competence.year),
    );
    for (let year = Number(TODAY.slice(0, 4)); year >= firstYear; year -= 1) {
      for (let index = funds.periodsPerYear(payroll.period); index >= 1; index -= 1) {
        if (funds.periodStart(year, index, payroll.period) > TODAY) continue;
        periods.push({ year, index });
      }
    }
  }
  const pending = funds.hasPayrollCalendar(detail)
    ? [...funds.onTheWay(detail.quarters).quarters].sort(
        (a, b) => a.year - b.year || a.quarter - b.quarter,
      )[0]
    : undefined;
  return {
    defaultKind:
      payroll !== null && !sources.some((source) => source.kind === "bank_debit" || source.kind === "manual")
        ? "payroll"
        : "voluntary",
    defaultFees: { voluntary: dec(voluntaryFee), payroll: dec(payrollFee) },
    periods,
    pendingPeriod: pending ? { year: pending.year, index: pending.quarter } : null,
  };
}

describe("GET /funds/{id}/valuations, against the tab", () => {
  it.each(PERIODS)("gives the tab's figures for %o", async (one) => {
    for (const id of Object.values(ids).slice(0, 3)) {
      const answer = await get(`/funds/${id}/valuations?${query(one)}`);
      const { detail, home } = await funds.fundHomeRow(ctx, id, NOW);
      const period = pagePeriod(one);
      const { line, beforeFirst, firstOn } = funds.fundSummary({ fund: home, period, todayOn: TODAY });
      expect(answer.beforeFirst).toBe(beforeFirst);
      expect(answer.period.span).toEqual(periodSpan(period, firstOn));
      const newest = [...home.points].sort((a, b) => (a.on < b.on ? 1 : -1))[0] ?? null;
      const recordedOn = new Map(detail.valuations.map((row) => [row.on, row.id]));
      expect(answer.valuesEver).toBe(home.points.length);
      expect(answer.lastValue).toEqual(newest === null ? null : { on: newest.on, value: dec(newest.cents) });
      expect(answer.lastValueClosesPrevious).toBe(
        newest !== null && funds.closesPeriodBefore(newest.on, period),
      );
      expect(answer.notInValue).toBe(dec(line.measure.notInValueCents));
      expect(answer.lines.map((each: Json) => each.valuationId)).toEqual(
        funds.valuationLines(line, period).map((each) => recordedOn.get(each.on) ?? null),
      );
      expect(answer.recorded.map((each: Json) => each.id)).toEqual(detail.valuations.map((each) => each.id));
      expect(
        answer.statements.map((each: Json) => [each.on, each.value, each.worker, each.reportedGain]),
      ).toEqual(
        detail.snapshots
          .filter((each) => funds.readsPeriod(each.valuationDate, period))
          .map((each) => [
            each.valuationDate,
            dec(each.valueCents),
            dec(each.workerCents),
            dec(each.reportedGainCents),
          ]),
      );
    }
  });
});

describe("GET /funds/{id}/settings, against the tab", () => {
  it("gives the tab's figures", async () => {
    for (const id of Object.values(ids).slice(0, 3)) {
      const answer = await get(`/funds/${id}/settings`);
      const { detail } = await funds.fundHomeRow(ctx, id, NOW);
      const sourceOf = byId<Json>(answer.sources);
      for (const source of detail.sources) {
        const calendar = funds.calendarOf(source);
        const due =
          source.kind === "payroll" && source.accrualPeriod !== null && funds.hasDueDates(calendar)
            ? funds.nextDueDates(source.accrualPeriod, calendar, TODAY)
            : [];
        expect(sourceOf.get(source.id).nextDue).toEqual(due);
        expect(sourceOf.get(source.id).dueDates).toEqual(calendar.entries);
      }
      expect(answer.payrollSourceId).toBe(detail.payroll?.source.id ?? null);
      const { current, expired } = arrangeFees(detail.fees, TODAY);
      expect(answer.fees.map((each: Json) => [each.id, each.expired])).toEqual([
        ...current.map((fee) => [fee.id, false]),
        ...expired.map((fee) => [fee.id, true]),
      ]);
      const value = detail.metrics.value;
      const onAssets = detail.fees.some(
        (fee) => fee.basis === "on_assets" && fee.rate !== null && feeValidOn(fee, TODAY),
      );
      const cost = value === null ? null : funds.assetsCost(detail.fees, value.cents, TODAY);
      expect(answer.assetsEstimate).toEqual(
        !onAssets
          ? { state: "none", amount: null, rate: null, value: null, on: null }
          : value === null || cost === null
            ? { state: "needs_value", amount: null, rate: null, value: null, on: null }
            : {
                state: "estimated",
                amount: dec(cost.cents),
                rate: cost.rate,
                value: dec(value.cents),
                on: value.on,
              },
      );
    }
  });
});

describe("the reads of the forms", () => {
  it("lists the movements the Overview's selector lists, on an account and on every account", async () => {
    const fund = await funds.requireFund(ctx, ids.debitId);
    for (const accountId of [ids.accountId, null]) {
      const answer = await get(
        `/funds/${ids.debitId}/movement-candidates${accountId ? `?accountId=${accountId}` : ""}`,
      );
      const expected = (
        await chargeCandidates(ctx, {
          accountId,
          from: fund.startOn,
          to: TODAY,
          types: ["expense", "transfer"],
        })
      )
        .slice(-60)
        .reverse();
      expect(expected.length).toBeGreaterThan(0);
      expect(answer.movements).toEqual(
        expected.map((each) => ({ id: each.id, on: each.on, payee: each.payee, amount: dec(each.cents) })),
      );
    }
  });

  it("answers the templates and the components another fund takes", async () => {
    const answer = await get("/funds/setup");
    expect(answer.templates).toEqual(JSON.parse(JSON.stringify(funds.FUND_TEMPLATES)));
    expect(answer.taken).toEqual(
      [...(await funds.takenComponents(ctx))].map(([component, fund]) => ({ component, fund })),
    );
  });

  it("answers 404 for the movements of a fund that is not the person's", async () => {
    const response = await routes.request(`/funds/00000000-0000-7000-8000-000000000001/movement-candidates`);
    expect(response.status).toBe(404);
  });
});

describe("the data of these tests", () => {
  it("reaches every branch the fields have", async () => {
    const overview = await get(`/funds/${ids.payslipId}?period=all`);
    expect(overview.units).not.toBeNull();
    expect(overview.lastPrice).not.toBeNull();
    expect(overview.bridge.lines).not.toBeNull();
    expect(overview.recent.length).toBeGreaterThan(0);
    expect(overview.line.origin.voluntary).not.toBe("0.00");
    const contributions = await get(`/funds/${ids.payslipId}/contributions?period=all`);
    expect(contributions.payroll.periods.flatMap((period: Json) => period.missingMonths)).toContain(
      "2031-05-01",
    );
    expect(contributions.payslips.length).toBeGreaterThan(0);
    expect(contributions.setup.periods.length).toBeGreaterThan(0);
    const valuations = await get(`/funds/${ids.payslipId}/valuations?period=all`);
    expect(valuations.statements.length).toBeGreaterThan(0);
    const debit = await get(`/funds/${ids.debitId}?period=2031`);
    expect(debit.debit).not.toBeNull();
    expect(debit.forecast.layout).toBe("short");
    const settings = await get(`/funds/${ids.debitId}/settings`);
    expect(settings.fees.some((fee: Json) => fee.expired)).toBe(true);
    expect(settings.assetsEstimate.state).toBe("estimated");
    const home = await get("/funds?period=all");
    expect(home.funds.some((fund: Json) => fund.state === "archived")).toBe(true);
    // The home of the reference has no rate in 2031; the debit fund has one.
    expect(debit.gain.bars.some((bar: Json) => bar.share !== null)).toBe(true);
  });
});
