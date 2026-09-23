import "server-only";
import { asc, desc } from "drizzle-orm";
import { listAccounts } from "@/modules/accounts/queries";
import { linkCandidates, transactionsByIds } from "@/modules/transactions/queries";
import type { Ctx } from "@/platform/context";
import {
  addDays,
  addMonths,
  type CivilDate,
  civilDateIn,
  type MonthKey,
  monthKey,
  monthsBetween,
  today,
} from "@/platform/dates";
import { getDb } from "@/platform/db/client";
import { userScoped } from "@/platform/db/scope";
import type { Cents } from "@/platform/money";
import { monthlyHistory, type PlatformStats, platformStats, portfolioStats } from "./rules";
import { investmentMovements, investmentPlatforms, investmentValuations } from "./schema";
import type { Movement, Platform, Valuation } from "./service";

/** The chart looks back at most this far; the table keeps every movement. */
const HISTORY_MONTHS = 36;
/** How far back a bank movement can be picked to document a platform movement. */
const LINK_WINDOW_DAYS = 400;

export interface PlatformView {
  platform: Platform;
  stats: PlatformStats;
  /** Share of the portfolio's value, `null` while any value is unknown. */
  share: number | null;
  movementCount: number;
}

/** The bank movement a platform movement points at, as the table shows it. */
export interface LinkedTransaction {
  id: string;
  on: CivilDate;
  cents: Cents;
  payee: string | null;
  accountName: string | null;
}

export interface MovementView {
  movement: Movement;
  platformName: string;
  linked: LinkedTransaction | null;
}

/** A bank movement offered in the "Link to an account movement" picker. */
export interface LinkOption {
  id: string;
  on: CivilDate;
  cents: Cents;
  payee: string | null;
  accountName: string | null;
}

export interface InvestmentsView {
  platforms: PlatformView[];
  /** The platform the page is narrowed to (`?platform=`), or `null` for all of them. */
  selected: Platform | null;
  totals: PlatformStats & { partial: boolean };
  months: MonthKey[];
  history: { invested: (Cents | null)[]; value: (Cents | null)[] };
  movements: MovementView[];
  valuations: (Valuation & { platformName: string })[];
  /** Bank movements that may be linked: money out (deposits) and money in (withdrawals). */
  linkOptions: { out: LinkOption[]; in: LinkOption[] };
}

/** Everything the Investments page renders, read once and narrowed to one platform if asked. */
export async function investmentsView(
  ctx: Pick<Ctx, "userId" | "timeZone">,
  input: { platformId?: string | null } = {},
  now: Date = new Date(),
): Promise<InvestmentsView> {
  const todayOn = today(ctx.timeZone, now);
  const [platforms, movements, valuations, accounts] = await Promise.all([
    getDb()
      .select()
      .from(investmentPlatforms)
      .where(userScoped(ctx).owns(investmentPlatforms))
      .orderBy(asc(investmentPlatforms.name), asc(investmentPlatforms.id)),
    getDb()
      .select()
      .from(investmentMovements)
      .where(userScoped(ctx).owns(investmentMovements))
      .orderBy(
        desc(investmentMovements.on),
        desc(investmentMovements.createdAt),
        desc(investmentMovements.id),
      ),
    getDb()
      .select()
      .from(investmentValuations)
      .where(userScoped(ctx).owns(investmentValuations))
      .orderBy(desc(investmentValuations.on), desc(investmentValuations.id)),
    listAccounts(ctx, { includeArchived: true }),
  ]);
  const selected = platforms.find((platform) => platform.id === input.platformId) ?? null;
  const inScope = <T extends { platformId: string }>(rows: readonly T[]) =>
    selected === null ? [...rows] : rows.filter((row) => row.platformId === selected.id);

  const perPlatform = platforms.map((platform) => ({
    platform,
    stats: platformStats(
      movements.filter((movement) => movement.platformId === platform.id),
      valuations.filter((valuation) => valuation.platformId === platform.id),
      todayOn,
    ),
    movementCount: movements.filter((movement) => movement.platformId === platform.id).length,
  }));
  const overall = portfolioStats(perPlatform.map((one) => one.stats));
  const views: PlatformView[] = perPlatform.map((one) => ({
    ...one,
    share:
      overall.valueCents === null || overall.valueCents <= 0n || one.stats.valueCents === null
        ? null
        : Number(one.stats.valueCents) / Number(overall.valueCents),
  }));
  const scoped = selected === null ? views : views.filter((view) => view.platform.id === selected.id);
  const totals = portfolioStats(scoped.map((view) => view.stats));

  const scopedMovements = inScope(movements);
  const first = scopedMovements.reduce<CivilDate | null>(
    (min, movement) => (min === null || movement.on < min ? movement.on : min),
    null,
  );
  const thisMonth = monthKey(todayOn);
  const months =
    first === null
      ? []
      : monthsBetween(
          monthKey(first) < addMonths(thisMonth, -(HISTORY_MONTHS - 1))
            ? addMonths(thisMonth, -(HISTORY_MONTHS - 1))
            : monthKey(first),
          thisMonth,
        );
  const history = monthlyHistory(
    scoped.map((view) => view.platform.id),
    scopedMovements,
    inScope(valuations),
    months,
  );

  const accountName = new Map(accounts.map((account) => [account.id, account.name]));
  const platformName = new Map(platforms.map((platform) => [platform.id, platform.name]));
  const linkedIds = scopedMovements.flatMap((movement) =>
    movement.transactionId ? [movement.transactionId] : [],
  );
  const [linked, out, incoming] = await Promise.all([
    transactionsByIds(ctx, linkedIds),
    linkCandidates(ctx, { direction: "out", from: addDays(todayOn, -LINK_WINDOW_DAYS), to: todayOn }),
    linkCandidates(ctx, { direction: "in", from: addDays(todayOn, -LINK_WINDOW_DAYS), to: todayOn }),
  ]);
  const taken = new Set(
    movements.flatMap((movement) => (movement.transactionId ? [movement.transactionId] : [])),
  );
  const option = (candidate: Awaited<ReturnType<typeof linkCandidates>>[number]): LinkOption => ({
    id: candidate.id,
    on: candidate.on,
    cents: candidate.cents,
    payee: candidate.payee,
    accountName: accountName.get(candidate.accountId) ?? null,
  });

  return {
    platforms: views,
    selected,
    totals,
    months,
    history,
    movements: scopedMovements.map((movement) => {
      const transaction = movement.transactionId ? linked.get(movement.transactionId) : undefined;
      return {
        movement,
        platformName: platformName.get(movement.platformId) ?? "",
        linked: transaction
          ? {
              id: transaction.id,
              on: civilDateIn(transaction.occurredAt, ctx.timeZone),
              cents: transaction.amountCents < 0n ? -transaction.amountCents : transaction.amountCents,
              payee: transaction.payee,
              accountName: accountName.get(transaction.accountId) ?? null,
            }
          : null,
      };
    }),
    valuations: inScope(valuations).map((valuation) => ({
      ...valuation,
      platformName: platformName.get(valuation.platformId) ?? "",
    })),
    // A bank movement documents one platform movement at most: the ones already taken are not
    // offered again (the movement being edited adds its own back in the dialog).
    linkOptions: {
      out: out.filter((candidate) => !taken.has(candidate.id)).map(option),
      in: incoming.filter((candidate) => !taken.has(candidate.id)).map(option),
    },
  };
}
