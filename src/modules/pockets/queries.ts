import "server-only";
import { and, asc, desc, eq, ne } from "drizzle-orm";
import { balancesOn, listAccounts } from "@/modules/accounts/queries";
import { accruedInterest } from "@/modules/interests/service";
import { chargeCandidates, transactionsByIds } from "@/modules/transactions/queries";
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
import {
  etaMonths,
  freeBalance,
  monthEndBalances,
  plannedVisible,
  pocketBalance,
  pocketBudget,
  pocketLedger,
} from "./rules";
import { pocketExpenseLinks, pocketMovements, pocketPlannedExpenses, pockets } from "./schema";
import type { Pocket, PocketMovement } from "./service";

/** How far back the chart looks. */
const HISTORY_MONTHS = 12;

/** How far back "Link an expense" offers movements from. */
const LINK_WINDOW_DAYS = 120;

/**
 * Why a pocket's share of the backing account's interest is what it is (spec §7.4): an estimate
 * from the account's accruals (F4), none because the account has no interest rule or no positive
 * balance, or none because a standalone pocket rests on no account at all.
 */
export type InterestReason = "estimate" | "no_interest_data" | "standalone";

/** An expense counted against a pocket, as its page lists it. */
export interface PocketExpense {
  /** The transaction's id; a spend recorded by hand before expenses were linked has the movement's. */
  id: string;
  on: CivilDate;
  /** Positive. */
  cents: Cents;
  payee: string | null;
  note: string | null;
  accountName: string | null;
  /** Filed by hand under a standalone pocket, so it can be taken out again. */
  linked: boolean;
  /** A withdrawal recorded by hand before expenses were counted, not a bank movement. */
  manual: boolean;
}

export interface PlannedExpense {
  id: string;
  description: string;
  cents: Cents;
  dueOn: CivilDate;
  /** Its day has passed; it stays a week, then goes. */
  overdue: boolean;
}

export interface PocketView {
  pocket: Pocket;
  accountName: string | null;
  /** What is left: the budget minus what was spent. */
  balanceCents: Cents;
  /** Every accrual, deposit and adjustment since the start: the budget given so far. */
  budgetCents: Cents;
  /** What the monthly accruals have added since the start: the design's "Accrued since …". */
  accruedCents: Cents;
  /** Spent since the start, negative. */
  spentCents: Cents;
  /** One month-end balance per month of `months`. */
  history: (Cents | null)[];
  /** Newest first. */
  expenses: PocketExpense[];
  /** Still shown (at most a week past their day), soonest first. */
  planned: PlannedExpense[];
  plannedCents: Cents;
  /** What would be left once the planned expenses are made. */
  projectedCents: Cents;
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

/**
 * The expenses of every open pocket. A pocket on an account takes each `expense` of that account
 * from its start month on — never a giroconto or an income, never a hidden one; a standalone pocket
 * takes the expenses linked to it.
 */
async function expensesByPocket(
  ctx: Pick<Ctx, "userId" | "timeZone">,
  open: readonly Pocket[],
  accountName: ReadonlyMap<string, string>,
  todayOn: CivilDate,
): Promise<Map<string, PocketExpense[]>> {
  const result = new Map<string, PocketExpense[]>(open.map((pocket) => [pocket.id, []]));

  const backed = open.filter((pocket) => pocket.backingAccountId !== null);
  const accountIds = [...new Set(backed.map((pocket) => pocket.backingAccountId as string))];
  for (const accountId of accountIds) {
    const on = backed.filter((pocket) => pocket.backingAccountId === accountId);
    const from = on.map((pocket) => pocket.startMonth).sort()[0];
    const charges = await chargeCandidates(ctx, { accountId, from, to: todayOn });
    for (const pocket of on) {
      result.set(
        pocket.id,
        charges
          .filter((charge) => charge.on >= pocket.startMonth)
          .map((charge) => ({
            id: charge.id,
            on: charge.on,
            cents: charge.cents,
            payee: charge.payee,
            note: charge.note,
            accountName: accountName.get(accountId) ?? null,
            linked: false,
            manual: false,
          })),
      );
    }
  }

  const standalone = new Set(open.filter((pocket) => pocket.backingAccountId === null).map((p) => p.id));
  if (standalone.size > 0) {
    const links = await getDb()
      .select({ pocketId: pocketExpenseLinks.pocketId, transactionId: pocketExpenseLinks.transactionId })
      .from(pocketExpenseLinks)
      .where(userScoped(ctx).owns(pocketExpenseLinks))
      .orderBy(asc(pocketExpenseLinks.id));
    const movements = await transactionsByIds(
      ctx,
      links.map((link) => link.transactionId),
    );
    for (const link of links) {
      const movement = movements.get(link.transactionId);
      if (!standalone.has(link.pocketId) || !movement) continue;
      if (movement.hiddenAt !== null || movement.removedUpstreamAt !== null) continue;
      result.get(link.pocketId)?.push({
        id: movement.id,
        on: civilDateIn(movement.occurredAt, ctx.timeZone),
        cents: -movement.amountCents,
        payee: movement.payee,
        note: movement.note,
        accountName: accountName.get(movement.accountId) ?? null,
        linked: true,
        manual: false,
      });
    }
  }
  return result;
}

const newestFirst = (a: PocketExpense, b: PocketExpense) =>
  a.on < b.on ? 1 : a.on > b.on ? -1 : a.id < b.id ? 1 : -1;

/** Everything the Pockets pages render (spec §7.4), read once. */
export async function pocketsView(
  ctx: Pick<Ctx, "userId" | "timeZone">,
  now: Date = new Date(),
): Promise<PocketsView> {
  const todayOn = today(ctx.timeZone, now);
  const thisMonth = monthKey(todayOn);
  const months = monthsBetween(addMonths(thisMonth, -(HISTORY_MONTHS - 1)), thisMonth);
  const [rows, movements, planned, accounts] = await Promise.all([
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
    getDb()
      .select()
      .from(pocketPlannedExpenses)
      .where(userScoped(ctx).owns(pocketPlannedExpenses))
      .orderBy(asc(pocketPlannedExpenses.dueOn), asc(pocketPlannedExpenses.id)),
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
  const [balances, expenses] = await Promise.all([
    balancesOn(ctx, backingIds, todayOn),
    expensesByPocket(ctx, open, accountName, todayOn),
  ]);

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
    // Withdrawals recorded by hand before expenses were counted still count, and are listed.
    const manual: PocketExpense[] = own
      .filter((movement) => movement.kind === "withdrawal")
      .map((movement) => ({
        id: movement.id,
        on: movement.on,
        cents: -movement.amountCents,
        payee: movement.reason,
        note: null,
        accountName: null,
        linked: false,
        manual: true,
      }));
    const spent = [...(expenses.get(pocket.id) ?? []), ...manual].sort(newestFirst);
    const ledger = pocketLedger(
      own.filter((movement) => movement.kind !== "withdrawal"),
      spent,
    );
    const balanceCents = pocketBalance(ledger);
    const upcoming = planned
      .filter((row) => row.pocketId === pocket.id && plannedVisible(row.dueOn, todayOn))
      .map((row) => ({
        id: row.id,
        description: row.description,
        cents: row.amountCents,
        dueOn: row.dueOn,
        overdue: row.dueOn < todayOn,
      }));
    const plannedCents = upcoming.reduce<Cents>((sum, row) => sum + row.cents, 0n);
    const interestCents = shareOf(pocket.backingAccountId, balanceCents);
    return {
      pocket,
      accountName: pocket.backingAccountId ? (accountName.get(pocket.backingAccountId) ?? null) : null,
      balanceCents,
      budgetCents: pocketBudget(ledger),
      accruedCents: pocketBalance(own.filter((movement) => movement.kind === "accrual")),
      spentCents: -spent.reduce<Cents>((sum, row) => sum + row.cents, 0n),
      history: monthEndBalances(ledger, months),
      expenses: spent,
      planned: upcoming,
      plannedCents,
      projectedCents: balanceCents - plannedCents,
      eta: etaMonths(pocket.targetCents, balanceCents, pocket.monthlyCents),
      interestCents,
      interestReason:
        pocket.backingAccountId === null
          ? "standalone"
          : interestCents === null
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

/** An expense "Link an expense" offers: positive amount, the person's own day. */
export interface LinkCandidate {
  id: string;
  on: CivilDate;
  cents: Cents;
  payee: string | null;
  accountName: string | null;
}

/**
 * The expenses a standalone pocket can take: the visible `expense` movements of the last months,
 * not on an account an open pocket rests on (those count there already) and not filed under a
 * pocket yet. Newest first.
 */
export async function expenseLinkCandidates(
  ctx: Pick<Ctx, "userId" | "timeZone">,
  now: Date = new Date(),
): Promise<LinkCandidate[]> {
  const todayOn = today(ctx.timeZone, now);
  const [charges, links, backing, accounts] = await Promise.all([
    chargeCandidates(ctx, { accountId: null, from: addDays(todayOn, -LINK_WINDOW_DAYS), to: todayOn }),
    getDb()
      .select({ transactionId: pocketExpenseLinks.transactionId })
      .from(pocketExpenseLinks)
      .where(userScoped(ctx).owns(pocketExpenseLinks))
      .orderBy(asc(pocketExpenseLinks.id)),
    getDb()
      .select({ accountId: pockets.backingAccountId })
      .from(pockets)
      .where(and(userScoped(ctx).owns(pockets), ne(pockets.state, "archived")))
      .orderBy(asc(pockets.id)),
    listAccounts(ctx, { includeArchived: true }),
  ]);
  const taken = new Set(links.map((link) => link.transactionId));
  const backed = new Set(backing.flatMap((row) => (row.accountId ? [row.accountId] : [])));
  const accountName = new Map(accounts.map((account) => [account.id, account.name]));
  return charges
    .filter((charge) => !taken.has(charge.id) && !backed.has(charge.accountId))
    .map((charge) => ({
      id: charge.id,
      on: charge.on,
      cents: charge.cents,
      payee: charge.payee,
      accountName: accountName.get(charge.accountId) ?? null,
    }))
    .reverse();
}

/** Overview's fourth KPI (design): what the open pockets have left, and what they add each month. */
export async function pocketsTotal(
  ctx: Pick<Ctx, "userId" | "timeZone">,
): Promise<{ totalCents: Cents; monthlyCents: Cents; count: number }> {
  const view = await pocketsView(ctx);
  return { totalCents: view.earmarkedCents, monthlyCents: view.monthlyCents, count: view.pockets.length };
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
