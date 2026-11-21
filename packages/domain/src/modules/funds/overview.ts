// What other readers take of the funds (decision D8; audit FND-1, FND-3): Investments the value of
// today, the export the numbers of «All», and the configuration the export lists beside them. One
// engine: the value is `fundValueAt`, the paid-in money and the gain are the period's (period.ts).
import { and, asc, eq, inArray } from "drizzle-orm";
import { listAccounts, listBalanceEntries } from "../accounts";
import type { Ctx } from "../../platform/context";
import { type CivilDate, today } from "../../shared/dates";
import { getDb } from "../../platform/db/client";
import { userScoped } from "../../platform/db/scope";
import type { Cents } from "../../shared/money";
import { fundSummary } from "./detail";
import { fundsHomeRows } from "./home-queries";
import { allPeriod, documentedPoints, fundValueAt, sortedPoints, type ValuePoint } from "./period";
import type { MovementLike } from "./pension/metrics";
import { fundOperations, funds, unitMovements } from "./schema";
import { feesOf, type Fund, type FundFee, type FundSource, sourcesOf } from "./service";

/**
 * The value another page shows (funds-ux §5.2, F5): today's (`fundValueAt`), and for a fund valued
 * only after today its newest value with its date, so that the fund is not left blank.
 */
function shownValue<T extends ValuePoint>(points: readonly T[], todayOn: CivilDate): T | null {
  return fundValueAt(points, todayOn) ?? sortedPoints(points).at(-1) ?? null;
}

/** One open fund as Investments lists it: what it is worth, with the day of that value. */
interface FundValueRow {
  fund: Fund;
  /** The fund's value today (`fundValueAt`): never a value the period of a page would not see. */
  valueCents: Cents | null;
  lastValuation: CivilDate | null;
}

/** One fund as the export prints it: the numbers of «All» on the Funds pages (decision D8). */
interface FundExportRow {
  fund: Fund;
  paidInCents: Cents | null;
  valueCents: Cents | null;
  gainCents: Cents | null;
  lastValuation: CivilDate | null;
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
 * The open funds as Investments lists them, with the value a fund's own page reads today (FND-3).
 * Only the readings: Investments shows the value, and nothing else of a fund.
 */
export async function fundValues(
  ctx: Pick<Ctx, "userId" | "timeZone">,
  now: Date = new Date(),
): Promise<FundValueRow[]> {
  const todayOn = today(ctx.timeZone, now);
  const open = await getDb()
    .select()
    .from(funds)
    .where(and(userScoped(ctx).owns(funds), eq(funds.state, "active")))
    .orderBy(asc(funds.name), asc(funds.id));
  const movementsOf = await unitMovementsOf(
    ctx,
    open.map((fund) => fund.id),
  );
  const rows: FundValueRow[] = [];
  for (const fund of open) {
    const points = documentedPoints(
      await listBalanceEntries(ctx, fund.valuationAccountId, 200),
      movementsOf.get(fund.id) ?? [],
    );
    const value = shownValue(points, todayOn);
    rows.push({ fund, valueCents: value?.cents ?? null, lastValuation: value?.on ?? null });
  }
  return rows;
}

/**
 * The funds as the export prints them, open and archived (decision D8): the paid-in money and the
 * gain of «All» on the Funds pages, the same engine, and the value of today. An archived fund has
 * no number: it is not money held today.
 */
export async function fundsExport(
  ctx: Pick<Ctx, "userId" | "timeZone">,
  now: Date = new Date(),
): Promise<FundExportRow[]> {
  const todayOn = today(ctx.timeZone, now);
  const rows = await fundsHomeRows(ctx, now);
  // The open funds first, the archived ones after them, each by name: the order the export has.
  const ordered = [
    ...rows.filter((row) => row.fund.state === "active"),
    ...rows.filter((row) => row.fund.state !== "active"),
  ];
  return ordered.map(({ fund, home }) => {
    if (fund.state !== "active") {
      return { fund, paidInCents: null, valueCents: null, gainCents: null, lastValuation: null };
    }
    const { measure } = fundSummary({ fund: home, period: allPeriod(todayOn), todayOn }).line;
    const value = shownValue(home.points, todayOn);
    return {
      fund,
      paidInCents: measure.paidInCents,
      valueCents: value?.cents ?? null,
      gainCents: measure.gainCents,
      lastValuation: value?.on ?? null,
    };
  });
}

/** A fund's sources and fees with the names an export needs: the fund's, the account's, the source's kind. */
interface FundsConfiguration {
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
