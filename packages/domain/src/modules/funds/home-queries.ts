import { asc } from "drizzle-orm";
import type { Ctx } from "../../platform/context";
import { today } from "../../platform/dates";
import { getDb } from "../../platform/db/client";
import { userScoped } from "../../platform/db/scope";
import type { Cents } from "../../platform/money";
import type { AccruedLine, HomeFund } from "./home";
import { onTheWay } from "./period";
import type { PendingQuarter } from "./pension/reconcile";
import { type FundDetail, fundDetailFlows, fundDetails, hasPayrollCalendar } from "./queries";
import { funds } from "./schema";
import { type Fund, requireFund } from "./service";
import { competencePeriod, type DebitStatus } from "./sources";
import { competenceOn } from "./tabs";

export interface HomeFundRow {
  home: HomeFund;
  fund: Fund;
  color: string | null;
  /** The running period of the fund's first recurring debit: always as of today (§6). */
  month: DebitStatus;
  /** "On the way": always as of today, never with the period (§5.3). */
  onTheWayCents: Cents;
  onTheWayQuarters: number;
  /** The periods behind it, with their deadlines. */
  onTheWay: PendingQuarter[];
  /**
   * Everything else a fund's page reads: its sources, its fees, its register. In the rows of the
   * home the valuations with their notes and the positions of the statements are empty, unless
   * asked for: only a fund's own page (`fundHomeRow`) shows them.
   */
  detail: FundDetail;
}

/** Every fund with what the home measures, read once: open and archived (decision 5 of §9). */
export async function fundsHomeRows(
  ctx: Pick<Ctx, "userId" | "timeZone">,
  now: Date = new Date(),
  /** The home does not show a fund's valuations and statements, so it does not read them. */
  options: { history: boolean } = { history: false },
): Promise<HomeFundRow[]> {
  const all = await getDb()
    .select()
    .from(funds)
    .where(userScoped(ctx).owns(funds))
    .orderBy(asc(funds.name), asc(funds.id));
  return rowsOf(ctx, all, now, options);
}

/**
 * One fund, read as the home reads it: a fund's page and its row in the home are the same numbers
 * because they are the same row (docs/design/funds-ux.md §6, F3).
 */
export async function fundHomeRow(
  ctx: Pick<Ctx, "userId" | "timeZone">,
  id: string,
  now: Date = new Date(),
): Promise<HomeFundRow> {
  return (await rowsOf(ctx, [await requireFund(ctx, id)], now, { history: true }))[0];
}

async function rowsOf(
  ctx: Pick<Ctx, "userId" | "timeZone">,
  list: readonly Fund[],
  now: Date,
  options: { history: boolean },
): Promise<HomeFundRow[]> {
  const todayOn = today(ctx.timeZone, now);
  const details = await fundDetails(ctx, list, now, options);
  return details.map((detail) => {
    const { fund } = detail;
    const period = detail.payroll?.period ?? "quarter";
    const dueOf = new Map(detail.quarters.map((one) => [`${one.year}-${one.quarter}`, one.due]));
    const accrued: AccruedLine[] = detail.competences.map((one) => ({
      on: competenceOn(one),
      cents:
        (one.workerCents ?? 0n) +
        (one.employerCents ?? 0n) +
        (one.tfrCents ?? 0n) +
        (one.workerEnrollmentCents ?? 0n) +
        (one.employerEnrollmentCents ?? 0n),
      dueOn: dueOf.get(`${one.year}-${competencePeriod(one, period)}`) ?? null,
    }));
    // Without due dates nothing is "on the way": a contribution counts on the day it is recorded.
    const coming = hasPayrollCalendar(detail) ? onTheWay(detail.quarters) : { cents: 0n, quarters: [] };
    const open = fund.state === "active";
    return {
      fund,
      color: detail.color,
      home: {
        id: fund.id,
        name: fund.name,
        archived: !open,
        points: detail.points,
        flows: fundDetailFlows(detail, todayOn),
        accrued,
      },
      month: detail.debits[0]?.status ?? { kind: "none" },
      onTheWayCents: open ? coming.cents : 0n,
      onTheWayQuarters: open ? coming.quarters.length : 0,
      onTheWay: open ? coming.quarters : [],
      detail,
    };
  });
}
