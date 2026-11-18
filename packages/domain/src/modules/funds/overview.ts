import { and, asc, eq, inArray } from "drizzle-orm";
import { listAccounts, listBalanceEntries } from "../accounts/queries";
import type { Ctx } from "../../platform/context";
import { type CivilDate, today } from "../../platform/dates";
import { getDb } from "../../platform/db/client";
import { userScoped } from "../../platform/db/scope";
import type { Cents } from "../../platform/money";
import { periodFees } from "./fees";
import { closingDay, documentedPoints, type ValuePoint } from "./period";
import type { MovementLike } from "./pension/metrics";
import { netOfFees } from "./pension/rules";
import { competenceFor } from "./pension/service";
import { calendarOf, payrollSourceOf } from "./queries";
import { fundOperations, funds, pensionCompetences, unitMovements } from "./schema";
import { feesOf, type Fund, type FundFee, type FundSource, sourcesOf } from "./service";
import { competencePeriod, dueOn } from "./sources";

/** One open fund as another module lists it: what it is worth, what went in, what it gained. */
export interface FundOverviewRow {
  fund: Fund;
  /** The last documented value, with its own day: never "as of today". */
  valueCents: Cents | null;
  lastValuation: CivilDate | null;
  /** Contributions, enrolment and voluntary payments, gross, to today. */
  paidInCents: Cents;
  /** Value − what had been paid in by the value's day; `null` with no value or nothing paid in. */
  gainCents: Cents | null;
}

export interface FundsOverview {
  rows: FundOverviewRow[];
  archived: Fund[];
}

interface Inflow {
  on: CivilDate;
  chargedCents: Cents;
}

const INFLOWS = ["contribution", "enrollment", "voluntary"];

/**
 * What each fund has paid in: the gross inflows of its register. A fund with no such operation and
 * a payslip source has nothing to put on that line yet, and an empty row says less than the money
 * the payslips already carry: for those funds the accrued periods stand in, each once its due date
 * has passed and dated by it, net of nothing — the gross is what is paid in. The first operation
 * ends the stand-in.
 */
async function inflowsOf(
  ctx: Pick<Ctx, "userId">,
  fundIds: readonly string[],
  todayOn: CivilDate,
): Promise<Map<string, Inflow[]>> {
  const flows = new Map<string, Inflow[]>(fundIds.map((id) => [id, []]));
  if (fundIds.length === 0) return flows;
  const rows = await getDb()
    .select({
      fundId: fundOperations.fundId,
      on: fundOperations.operationDate,
      classification: fundOperations.classification,
      worker: fundOperations.workerCents,
      employer: fundOperations.employerCents,
      tfr: fundOperations.tfrCents,
      other: fundOperations.otherCents,
    })
    .from(fundOperations)
    .where(and(userScoped(ctx).owns(fundOperations), inArray(fundOperations.fundId, [...fundIds])))
    .orderBy(asc(fundOperations.operationDate), asc(fundOperations.id));
  for (const row of rows) {
    if (!INFLOWS.includes(row.classification)) continue;
    flows
      .get(row.fundId)!
      .push({ on: row.on, chargedCents: row.worker + row.employer + row.tfr + row.other });
  }

  const bare = fundIds.filter((id) => flows.get(id)!.length === 0);
  if (bare.length === 0) return flows;
  const sources = (await sourcesOf(ctx, bare)).filter((source) => source.kind === "payroll");
  if (sources.length === 0) return flows;
  const [fees, accrued] = await Promise.all([
    feesOf(ctx, bare),
    getDb()
      .select()
      .from(pensionCompetences)
      .where(and(userScoped(ctx).owns(pensionCompetences), inArray(pensionCompetences.fundId, bare)))
      .orderBy(asc(pensionCompetences.year), asc(pensionCompetences.quarter), asc(pensionCompetences.id)),
  ]);
  for (const fundId of bare) {
    const source = payrollSourceOf(sources.filter((one) => one.fundId === fundId));
    if (!source || source.accrualPeriod === null) continue;
    const period = source.accrualPeriod;
    const calendar = calendarOf(source);
    const estimate = periodFees(
      fees.filter((fee) => fee.fundId === fundId),
      { sourceId: source.id, period, on: todayOn },
    );
    const byPeriod = new Map<string, { due: CivilDate; contribution: Cents; enrollment: Cents }>();
    for (const raw of accrued) {
      if (raw.fundId !== fundId) continue;
      const row = competenceFor(raw, source.components ?? []);
      const index = competencePeriod(row, period);
      // The money leaves on its period's deadline, whatever month the payslip was: a period still
      // running has accrued something and paid in nothing.
      const due = dueOn(row.year, index, period, calendar);
      if (due === null || due > todayOn) continue;
      const key = `${row.year}-${index}`;
      const one = byPeriod.get(key) ?? { due, contribution: 0n, enrollment: 0n };
      one.contribution += (row.workerCents ?? 0n) + (row.employerCents ?? 0n) + (row.tfrCents ?? 0n);
      one.enrollment += (row.workerEnrollmentCents ?? 0n) + (row.employerEnrollmentCents ?? 0n);
      byPeriod.set(key, one);
    }
    for (const one of byPeriod.values()) {
      if (one.contribution === 0n) continue;
      const flow = netOfFees(one.contribution, one.enrollment, estimate);
      flows.get(fundId)!.push({ on: one.due, chargedCents: flow.grossCents });
    }
  }
  return flows;
}

/** The unit movements of each fund, for the points they document. */
async function unitMovementsOf(
  ctx: Pick<Ctx, "userId">,
  fundIds: readonly string[],
): Promise<Map<string, MovementLike[]>> {
  const byFund = new Map<string, MovementLike[]>();
  if (fundIds.length === 0) return byFund;
  const rows = await getDb()
    .select({
      fundId: fundOperations.fundId,
      operationId: unitMovements.operationId,
      compartment: unitMovements.compartment,
      units: unitMovements.units,
      unitPrice: unitMovements.unitPrice,
      unitPriceDate: unitMovements.unitPriceDate,
    })
    .from(unitMovements)
    .innerJoin(fundOperations, eq(fundOperations.id, unitMovements.operationId))
    .where(and(userScoped(ctx).owns(unitMovements), inArray(fundOperations.fundId, [...fundIds])))
    .orderBy(asc(unitMovements.operationId), asc(unitMovements.position));
  for (const { fundId, ...movement } of rows) byFund.set(fundId, [...(byFund.get(fundId) ?? []), movement]);
  return byFund;
}

/**
 * The funds as Investments and the export list them: one row per open fund, with the value its own
 * page reads. A fund's value is its last documented point, with its own date (funds-ux §5.2) — never
 * "as of today", which would leave a fund valued only in the future blank.
 */
export async function fundsOverview(
  ctx: Pick<Ctx, "userId" | "timeZone">,
  now: Date = new Date(),
): Promise<FundsOverview> {
  const todayOn = today(ctx.timeZone, now);
  const all = await getDb()
    .select()
    .from(funds)
    .where(userScoped(ctx).owns(funds))
    .orderBy(asc(funds.name), asc(funds.id));
  const open = all.filter((fund) => fund.state === "active");
  const ids = open.map((fund) => fund.id);
  const [movementsOf, inflows] = await Promise.all([unitMovementsOf(ctx, ids), inflowsOf(ctx, ids, todayOn)]);
  const rows: FundOverviewRow[] = [];
  for (const fund of open) {
    const points = documentedPoints(
      await listBalanceEntries(ctx, fund.valuationAccountId, 200),
      movementsOf.get(fund.id) ?? [],
    );
    const newest = (from: readonly ValuePoint[]) =>
      from.reduce<ValuePoint | null>(
        (last, point) => (last === null || point.on > last.on ? point : last),
        null,
      );
    // What the home calls today's value; a point after today only when there is nothing else.
    const latest = newest(points.filter((point) => point.on <= closingDay(todayOn))) ?? newest(points);
    const own = inflows.get(fund.id) ?? [];
    const paidInCents = own.reduce<Cents>((sum, flow) => sum + flow.chargedCents, 0n);
    // The gain is measured against what had gone in by the date of the value: money that left
    // afterwards is not inside the position it would be compared to. With nothing gone in, a value
    // is a position and not a gain, so it stays unknown rather than being claimed whole.
    const basis = own
      .filter((flow) => latest === null || flow.on <= latest.on)
      .reduce<Cents>((sum, flow) => sum + flow.chargedCents, 0n);
    rows.push({
      fund,
      valueCents: latest?.cents ?? null,
      lastValuation: latest?.on ?? null,
      paidInCents,
      gainCents: latest === null || basis === 0n ? null : latest.cents - basis,
    });
  }
  return { rows, archived: all.filter((fund) => fund.state === "archived") };
}

/** A fund's sources and fees with the names an export needs: the fund's, the account's, the source's kind. */
export interface FundsConfiguration {
  sources: (FundSource & { fundName: string; accountName: string | null })[];
  fees: (FundFee & { fundName: string; sourceKind: FundSource["kind"] | null })[];
}

/** How every fund of a person is configured, open and archived: what the export lists beside the funds. */
export async function fundsConfiguration(ctx: Pick<Ctx, "userId">): Promise<FundsConfiguration> {
  const all = await getDb()
    .select({ id: funds.id, name: funds.name })
    .from(funds)
    .where(userScoped(ctx).owns(funds))
    .orderBy(asc(funds.name), asc(funds.id));
  const ids = all.map((fund) => fund.id);
  const [sources, fees, accounts] = await Promise.all([
    sourcesOf(ctx, ids),
    feesOf(ctx, ids),
    listAccounts(ctx, { includeArchived: true }),
  ]);
  const fundName = new Map(all.map((fund) => [fund.id, fund.name]));
  const accountName = new Map(accounts.map((account) => [account.id, account.name]));
  const kindOf = new Map(sources.map((source) => [source.id, source.kind]));
  const byFund = <T extends { fundId: string }>(rows: T[]) =>
    [...rows].sort((a, b) => ids.indexOf(a.fundId) - ids.indexOf(b.fundId));
  return {
    sources: byFund(sources).map((source) => ({
      ...source,
      fundName: fundName.get(source.fundId) ?? "",
      accountName: source.accountId === null ? null : (accountName.get(source.accountId) ?? null),
    })),
    fees: byFund(fees).map((fee) => ({
      ...fee,
      fundName: fundName.get(fee.fundId) ?? "",
      sourceKind: fee.sourceId === null ? null : (kindOf.get(fee.sourceId) ?? null),
    })),
  };
}
