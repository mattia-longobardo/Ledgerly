import "server-only";
import { asc } from "drizzle-orm";
import { listAccounts, listBalanceEntries } from "@/modules/accounts/queries";
import type { Ctx } from "@/platform/context";
import { addMonths, type CivilDate, type MonthKey, monthKey, today } from "@/platform/dates";
import { getDb } from "@/platform/db/client";
import { userScoped } from "@/platform/db/scope";
import type { Cents } from "@/platform/money";
import type { AccruedLine, HomeFund } from "./home";
import { documentedPoints, onTheWay, pacFlows } from "./period";
import type { MovementLike } from "./pension/metrics";
import { pensionDetail, pensionDetailFlows } from "./pension/queries";
import { type MonthStatus, depositsOf, monthStatus } from "./queries";
import { funds } from "./schema";
import type { Fund } from "./service";

/** A fund's values over its whole life: the sum of the years depends on every one of them. */
const ALL_ENTRIES = 100_000;

export interface HomeFundRow {
  home: HomeFund;
  fund: Fund;
  color: string | null;
  /** The plan and this month's deposit: always as of today (§6). */
  month: MonthStatus;
  /** "On the way": always as of today, never with the period (§5.3). */
  onTheWayCents: Cents;
  onTheWayQuarters: number;
}

const quarterStart = (year: number, quarter: number): MonthKey =>
  addMonths(monthKey(`${year}-01-01`), (quarter - 1) * 3);

/** Every fund with what the home measures, read once: open and archived (decision 5 of §9). */
export async function fundsHomeRows(
  ctx: Pick<Ctx, "userId" | "timeZone">,
  now: Date = new Date(),
): Promise<HomeFundRow[]> {
  const todayOn = today(ctx.timeZone, now);
  const all = await getDb()
    .select()
    .from(funds)
    .where(userScoped(ctx).owns(funds))
    .orderBy(asc(funds.name), asc(funds.id));
  const [deposits, accounts] = await Promise.all([
    depositsOf(
      ctx,
      all.map((fund) => fund.id),
    ),
    listAccounts(ctx, { includeArchived: true }),
  ]);
  const colorOf = new Map(accounts.map((account) => [account.id, account.color]));

  return Promise.all(
    all.map(async (fund): Promise<HomeFundRow> => {
      const entries = await listBalanceEntries(ctx, fund.valuationAccountId, ALL_ENTRIES);
      const base = {
        fund,
        color: colorOf.get(fund.valuationAccountId) ?? null,
      };
      const identity = {
        id: fund.id,
        name: fund.name,
        type: fund.type,
        archived: fund.state !== "active",
      };
      if (fund.type !== "pension") {
        const own = deposits.get(fund.id) ?? [];
        return {
          ...base,
          home: { ...identity, points: documentedPoints(entries), flows: pacFlows(own), accrued: [] },
          month: monthStatus(fund, own, todayOn),
          onTheWayCents: 0n,
          onTheWayQuarters: 0,
        };
      }
      const detail = await pensionDetail(ctx, fund.id, now);
      const movements: MovementLike[] = detail.movements.map((movement) => ({
        operationId: movement.operationId,
        compartment: movement.compartment,
        units: movement.units,
        unitPrice: movement.unitPrice,
        unitPriceDate: movement.unitPriceDate,
      }));
      const dueOf = new Map(detail.quarters.map((one) => [`${one.year}-${one.quarter}`, one.due]));
      const accrued: AccruedLine[] = detail.competences.map((one) => ({
        on: (one.payrollPeriod ?? quarterStart(one.year, one.quarter)) as CivilDate,
        cents:
          (one.workerCents ?? 0n) +
          (one.employerCents ?? 0n) +
          (one.tfrCents ?? 0n) +
          (one.workerEnrollmentCents ?? 0n) +
          (one.employerEnrollmentCents ?? 0n),
        dueOn: dueOf.get(`${one.year}-${one.quarter}`) ?? null,
      }));
      const coming = onTheWay(detail.quarters);
      return {
        ...base,
        home: {
          ...identity,
          points: documentedPoints(entries, movements),
          flows: pensionDetailFlows(detail),
          accrued,
        },
        month: { kind: "none" },
        onTheWayCents: fund.state === "active" ? coming.cents : 0n,
        onTheWayQuarters: fund.state === "active" ? coming.quarters.length : 0,
      };
    }),
  );
}
