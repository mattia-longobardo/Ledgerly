import "server-only";
import { asc } from "drizzle-orm";
import { listAccounts, listBalanceEntries } from "@/modules/accounts/queries";
import type { Ctx } from "@/platform/context";
import { today } from "@/platform/dates";
import { getDb } from "@/platform/db/client";
import { userScoped } from "@/platform/db/scope";
import type { Cents } from "@/platform/money";
import type { AccruedLine, HomeFund } from "./home";
import { documentedPoints, onTheWay, pacFlows } from "./period";
import type { MovementLike } from "./pension/metrics";
import { type PensionDetail, pensionDetail, pensionDetailFlows } from "./pension/queries";
import type { PendingQuarter } from "./pension/reconcile";
import { type MonthStatus, depositsOf, monthStatus } from "./queries";
import { funds } from "./schema";
import { type Fund, type FundDeposit, requireFund } from "./service";
import { competenceOn } from "./tabs";

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
  /** The quarters behind it, with their deadlines. */
  onTheWay: PendingQuarter[];
  /** What the pension side of a fund's page reads besides the numbers; `null` for a PAC. */
  pension: PensionDetail | null;
}

/** Every fund with what the home measures, read once: open and archived (decision 5 of §9). */
export async function fundsHomeRows(
  ctx: Pick<Ctx, "userId" | "timeZone">,
  now: Date = new Date(),
): Promise<HomeFundRow[]> {
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
    all.map((fund) =>
      rowOf(ctx, fund, deposits.get(fund.id) ?? [], colorOf.get(fund.valuationAccountId) ?? null, now),
    ),
  );
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
  const fund = await requireFund(ctx, id);
  const [deposits, accounts] = await Promise.all([
    depositsOf(ctx, [fund.id]),
    listAccounts(ctx, { includeArchived: true }),
  ]);
  const color = accounts.find((account) => account.id === fund.valuationAccountId)?.color ?? null;
  return rowOf(ctx, fund, deposits.get(fund.id) ?? [], color, now);
}

async function rowOf(
  ctx: Pick<Ctx, "userId" | "timeZone">,
  fund: Fund,
  own: FundDeposit[],
  color: string | null,
  now: Date,
): Promise<HomeFundRow> {
  const todayOn = today(ctx.timeZone, now);
  const entries = await listBalanceEntries(ctx, fund.valuationAccountId, ALL_ENTRIES);
  const base = { fund, color };
  const identity = {
    id: fund.id,
    name: fund.name,
    type: fund.type,
    archived: fund.state !== "active",
  };
  if (fund.type !== "pension") {
    return {
      ...base,
      home: { ...identity, points: documentedPoints(entries), flows: pacFlows(own), accrued: [] },
      month: monthStatus(fund, own, todayOn),
      onTheWayCents: 0n,
      onTheWayQuarters: 0,
      onTheWay: [],
      pension: null,
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
    on: competenceOn(one),
    cents:
      (one.workerCents ?? 0n) +
      (one.employerCents ?? 0n) +
      (one.tfrCents ?? 0n) +
      (one.workerEnrollmentCents ?? 0n) +
      (one.employerEnrollmentCents ?? 0n),
    dueOn: dueOf.get(`${one.year}-${one.quarter}`) ?? null,
  }));
  const coming = onTheWay(detail.quarters);
  const open = fund.state === "active";
  return {
    ...base,
    home: {
      ...identity,
      points: documentedPoints(entries, movements),
      flows: pensionDetailFlows(detail),
      accrued,
    },
    month: { kind: "none" },
    onTheWayCents: open ? coming.cents : 0n,
    onTheWayQuarters: open ? coming.quarters.length : 0,
    onTheWay: open ? coming.quarters : [],
    pension: detail,
  };
}
