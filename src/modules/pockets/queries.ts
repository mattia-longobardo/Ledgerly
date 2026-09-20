import "server-only";
import { and, asc, desc, eq, ne } from "drizzle-orm";
import { balancesOn, listAccounts } from "@/modules/accounts/queries";
import { accruedInterest } from "@/modules/interests/service";
import type { Ctx } from "@/platform/context";
import {
  addDays,
  addMonths,
  type CivilDate,
  type MonthKey,
  monthKey,
  monthsBetween,
  today,
} from "@/platform/dates";
import { getDb } from "@/platform/db/client";
import { userScoped } from "@/platform/db/scope";
import type { Cents } from "@/platform/money";
import { etaMonths, freeBalance, monthEndBalances, pocketBalance, withdrawnSince } from "./rules";
import { pocketMovements, pockets } from "./schema";
import type { Pocket, PocketMovement } from "./service";

/** How far back the chart and "Withdrawn · 12 months" look. */
const HISTORY_MONTHS = 12;

/**
 * Why a pocket's share of the backing account's interest is what it is (spec §7.4): an estimate
 * from the account's accruals (F4), none because the account has no interest rule or no positive
 * balance, or none because a standalone pocket rests on no account at all.
 */
export type InterestReason = "estimate" | "no_interest_data" | "standalone";

export interface PocketView {
  pocket: Pocket;
  accountName: string | null;
  balanceCents: Cents;
  /** What the monthly accruals have added since the start: the design's "Accrued since …". */
  accruedCents: Cents;
  /** One month-end balance per month of `months`. */
  history: (Cents | null)[];
  withdrawals: PocketMovement[];
  /** Withdrawn in the last twelve months, negative. */
  withdrawnCents: Cents;
  eta: number | null;
  /**
   * Spec §7.4, "stima": what the backing account's rules accrued, net, in the last twelve months ×
   * (pocket balance ÷ account balance). `null` — unknown, never zero — without a rule or a
   * positive balance (plan F4 §3.4.10).
   */
  interestCents: Cents | null;
  interestReason: InterestReason;
}

export interface PocketsView {
  months: MonthKey[];
  pockets: PocketView[];
  archived: Pocket[];
  earmarkedCents: Cents;
  backingCents: Cents | null;
  backingNames: string[];
  freeCents: Cents | null;
  /** Per backing account: what is left there after its pockets ("Free on …" in the dialog). */
  freeByAccount: Record<string, Cents | null>;
  monthlyCents: Cents;
  nextAccrual: CivilDate;
  accounts: { id: string; name: string }[];
}

/** Everything the Pockets page renders (spec §7.4), read once. */
export async function pocketsView(
  ctx: Pick<Ctx, "userId" | "timeZone">,
  now: Date = new Date(),
): Promise<PocketsView> {
  const todayOn = today(ctx.timeZone, now);
  const thisMonth = monthKey(todayOn);
  const months = monthsBetween(addMonths(thisMonth, -(HISTORY_MONTHS - 1)), thisMonth);
  const [rows, movements, accounts] = await Promise.all([
    getDb()
      .select()
      .from(pockets)
      .where(userScoped(ctx).owns(pockets))
      .orderBy(asc(pockets.name), asc(pockets.id)),
    getDb()
      .select()
      .from(pocketMovements)
      .where(userScoped(ctx).owns(pocketMovements))
      .orderBy(asc(pocketMovements.on), asc(pocketMovements.id)),
    listAccounts(ctx, { includeArchived: true }),
  ]);
  const byPocket = new Map<string, PocketMovement[]>();
  for (const movement of movements) {
    byPocket.set(movement.pocketId, [...(byPocket.get(movement.pocketId) ?? []), movement]);
  }
  const accountName = new Map(accounts.map((account) => [account.id, account.name]));
  const open = rows.filter((pocket) => pocket.state !== "archived");
  const backingIds = [
    ...new Set(open.flatMap((pocket) => (pocket.backingAccountId ? [pocket.backingAccountId] : []))),
  ];
  const balances = await balancesOn(ctx, backingIds, todayOn);
  const yearAgo = `${addMonths(thisMonth, -(HISTORY_MONTHS - 1)).slice(0, 7)}-01`;

  const interestFrom = addDays(todayOn, -364);
  const accruedByAccount = new Map(
    await Promise.all(
      backingIds.map(async (id) => [id, await accruedInterest(ctx, id, interestFrom, todayOn)] as const),
    ),
  );
  const shareOf = (accountId: string | null, balanceCents: Cents): Cents | null => {
    if (accountId === null) return null;
    const accrued = accruedByAccount.get(accountId) ?? null;
    const accountBalance = balances.get(accountId) ?? null;
    if (accrued === null || accountBalance === null || accountBalance <= 0n || balanceCents <= 0n)
      return null;
    return (accrued * balanceCents * 2n + accountBalance) / (accountBalance * 2n);
  };

  const views: PocketView[] = open.map((pocket) => {
    const own = byPocket.get(pocket.id) ?? [];
    const balanceCents = pocketBalance(own);
    return {
      pocket,
      accountName: pocket.backingAccountId ? (accountName.get(pocket.backingAccountId) ?? null) : null,
      balanceCents,
      accruedCents: pocketBalance(own.filter((movement) => movement.kind === "accrual")),
      history: monthEndBalances(own, months),
      withdrawals: own
        .filter((movement) => movement.kind === "withdrawal" && movement.on >= yearAgo)
        .reverse(),
      withdrawnCents: withdrawnSince(own, yearAgo),
      eta: etaMonths(pocket.targetCents, balanceCents, pocket.monthlyCents),
      interestCents: shareOf(pocket.backingAccountId, balanceCents),
      interestReason:
        pocket.backingAccountId === null
          ? "standalone"
          : shareOf(pocket.backingAccountId, balanceCents) === null
            ? "no_interest_data"
            : "estimate",
    };
  });

  const counted = views.map((view) => ({
    backingAccountId: view.pocket.backingAccountId,
    balanceCents: view.balanceCents,
  }));
  const free = freeBalance(balances, counted);
  const freeByAccount = Object.fromEntries(
    backingIds.map((id) => [
      id,
      freeBalance(
        balances,
        counted.filter((pocket) => pocket.backingAccountId === id),
      ).freeCents,
    ]),
  );

  return {
    months,
    pockets: views,
    archived: rows.filter((pocket) => pocket.state === "archived"),
    earmarkedCents: pocketBalance(views.map((view) => ({ amountCents: view.balanceCents }))),
    backingCents: free.backingCents,
    backingNames: backingIds.map((id) => accountName.get(id) ?? "").filter((name) => name !== ""),
    freeCents: free.freeCents,
    freeByAccount,
    monthlyCents: open
      .filter((pocket) => pocket.state === "active")
      .reduce<Cents>((sum, pocket) => sum + (pocket.monthlyCents ?? 0n), 0n),
    nextAccrual: addMonths(thisMonth, 1),
    accounts: accounts
      .filter((account) => account.state !== "archived")
      .map((account) => ({ id: account.id, name: account.name })),
  };
}

/** Overview's fourth KPI (design): what the open pockets hold, and what they add each month. */
export async function pocketsTotal(
  ctx: Pick<Ctx, "userId">,
): Promise<{ totalCents: Cents; monthlyCents: Cents; count: number }> {
  const rows = await getDb()
    .select({ id: pockets.id, state: pockets.state, monthlyCents: pockets.monthlyCents })
    .from(pockets)
    .where(and(userScoped(ctx).owns(pockets), ne(pockets.state, "archived")));
  const movements = await getDb()
    .select({ pocketId: pocketMovements.pocketId, amountCents: pocketMovements.amountCents })
    .from(pocketMovements)
    .where(userScoped(ctx).owns(pocketMovements));
  const open = new Set(rows.map((row) => row.id));
  return {
    totalCents: pocketBalance(movements.filter((movement) => open.has(movement.pocketId))),
    monthlyCents: rows
      .filter((row) => row.state === "active")
      .reduce<Cents>((sum, row) => sum + (row.monthlyCents ?? 0n), 0n),
    count: rows.length,
  };
}

/** The open pockets resting on an account, for Account detail (design: "Pockets" row). */
export async function pocketsOnAccount(
  ctx: Pick<Ctx, "userId">,
  accountId: string,
): Promise<{ id: string; name: string }[]> {
  return getDb()
    .select({ id: pockets.id, name: pockets.name })
    .from(pockets)
    .where(
      and(
        userScoped(ctx).owns(pockets),
        eq(pockets.backingAccountId, accountId),
        ne(pockets.state, "archived"),
      ),
    )
    .orderBy(asc(pockets.name), asc(pockets.id));
}

/** Pockets by name, for the ⌘K palette (spec §8.2). */
export async function searchPockets(
  ctx: Pick<Ctx, "userId">,
  term: string,
): Promise<{ id: string; name: string }[]> {
  const needle = term.trim().toLocaleLowerCase();
  if (needle === "") return [];
  const rows = await getDb()
    .select({ id: pockets.id, name: pockets.name })
    .from(pockets)
    .where(and(userScoped(ctx).owns(pockets), ne(pockets.state, "archived")))
    .orderBy(asc(pockets.name), desc(pockets.id));
  return rows.filter((row) => row.name.toLocaleLowerCase().includes(needle)).slice(0, 5);
}
