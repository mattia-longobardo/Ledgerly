import { and, asc, eq, ne } from "drizzle-orm";
import { accountNames, accountOptions, readingsAt, listAccounts } from "../accounts";
import { accruedInterestByAccount } from "../interests";
import { chargeCandidates, transactionsByIds } from "../transactions";
import type { Ctx } from "../../platform/context";
import {
  addDays,
  addMonths,
  type CivilDate,
  civilDateIn,
  type MonthKey,
  monthKey,
  monthsBetween,
  today,
} from "../../shared/dates";
import { getDb } from "../../platform/db/client";
import { userScoped } from "../../platform/db/scope";
import type { Cents } from "../../shared/money";
import {
  etaMonths,
  freeBalance,
  type InterestReason,
  monthEndBalances,
  plannedVisible,
  pocketBalance,
  pocketBudget,
  pocketLedger,
  splitInterest,
  targetPercent,
} from "./rules";
import { pocketExpenseLinks, pocketMovements, pocketPlannedExpenses, pockets } from "./schema";
import type { Pocket, PocketMovement } from "./service";

/** How far back the chart looks. */
const HISTORY_MONTHS = 12;

/** How far back "Link an expense" offers movements from. */
const LINK_WINDOW_DAYS = 120;

/** An expense counted against a pocket, as its page lists it. */
interface PocketExpense {
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

interface PlannedExpense {
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
  /** Balance over target, whole; `null` without a target. */
  percent: number | null;
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

interface PocketsView {
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

/** A spend of a pocket before its account has a name: the ledger needs none. */
type Spend = Omit<PocketExpense, "accountName"> & { accountId: string | null };

/**
 * The expenses of every open pocket. A pocket on an account takes each `expense` of that account
 * from its start month on — never a giroconto or an income, never a hidden one; a standalone pocket
 * takes the expenses linked to it. One read for every backing account (audit POC-3).
 */
async function expensesByPocket(
  ctx: Pick<Ctx, "userId" | "timeZone">,
  open: readonly Pocket[],
  todayOn: CivilDate,
): Promise<Map<string, Spend[]>> {
  const result = new Map<string, Spend[]>(open.map((pocket) => [pocket.id, []]));

  const backed = open.filter((pocket) => pocket.backingAccountId !== null);
  const accountIds = [...new Set(backed.map((pocket) => pocket.backingAccountId as string))];
  if (accountIds.length > 0) {
    const from = backed.map((pocket) => pocket.startMonth).sort()[0];
    const charges = await chargeCandidates(ctx, { accountId: accountIds, from, to: todayOn });
    for (const pocket of backed) {
      result.set(
        pocket.id,
        charges
          .filter((charge) => charge.accountId === pocket.backingAccountId && charge.on >= pocket.startMonth)
          .map((charge) => ({
            id: charge.id,
            on: charge.on,
            cents: charge.cents,
            payee: charge.payee,
            note: charge.note,
            accountId: charge.accountId,
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
        accountId: movement.accountId,
        linked: true,
        manual: false,
      });
    }
  }
  return result;
}

const newestFirst = (a: Spend, b: Spend) => (a.on < b.on ? 1 : a.on > b.on ? -1 : a.id < b.id ? 1 : -1);

/** One open pocket's ledger: its own movements, its expenses, and what is left. */
interface PocketLedger {
  pocket: Pocket;
  own: PocketMovement[];
  /** Newest first, the withdrawals recorded by hand among them. */
  spent: Spend[];
  ledger: ReturnType<typeof pocketLedger>;
  balanceCents: Cents;
}

/** Every pocket, and the ledger of each open one: what `pocketBalances` and the view share. */
async function pocketLedgers(
  ctx: Pick<Ctx, "userId" | "timeZone">,
  todayOn: CivilDate,
): Promise<{ rows: Pocket[]; ledgers: PocketLedger[] }> {
  const [rows, movements] = await Promise.all([
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
  ]);
  const byPocket = Map.groupBy(movements, (movement) => movement.pocketId);
  const open = rows.filter((pocket) => pocket.state !== "archived");
  const expenses = await expensesByPocket(ctx, open, todayOn);
  const ledgers = open.map((pocket) => {
    const own = byPocket.get(pocket.id) ?? [];
    // Withdrawals recorded by hand before expenses were counted still count, and are listed.
    const manual: Spend[] = own
      .filter((movement) => movement.kind === "withdrawal")
      .map((movement) => ({
        id: movement.id,
        on: movement.on,
        cents: -movement.amountCents,
        payee: movement.reason,
        note: null,
        accountId: null,
        linked: false,
        manual: true,
      }));
    const spent = [...(expenses.get(pocket.id) ?? []), ...manual].sort(newestFirst);
    const ledger = pocketLedger(
      own.filter((movement) => movement.kind !== "withdrawal"),
      spent,
    );
    return { pocket, own, spent, ledger, balanceCents: pocketBalance(ledger) };
  });
  return { rows, ledgers };
}

/**
 * What each open pocket has left (audit POC-1): the one balance Overview, the Pockets page, the API
 * and the export share. The balance is derived, never stored, so it reads the ledger but nothing the
 * page alone needs (planned expenses, balances of the accounts, interest).
 */
export async function pocketBalances(
  ctx: Pick<Ctx, "userId" | "timeZone">,
): Promise<{ pocket: Pocket; balanceCents: Cents }[]> {
  const { ledgers } = await pocketLedgers(ctx, today(ctx.timeZone));
  return ledgers.map(({ pocket, balanceCents }) => ({ pocket, balanceCents }));
}

/** Everything the Pockets pages render (spec §7.4), read once. */
export async function pocketsView(
  ctx: Pick<Ctx, "userId" | "timeZone">,
  now: Date = new Date(),
): Promise<PocketsView> {
  const todayOn = today(ctx.timeZone, now);
  const thisMonth = monthKey(todayOn);
  const months = monthsBetween(addMonths(thisMonth, -(HISTORY_MONTHS - 1)), thisMonth);
  const [{ rows, ledgers }, planned, accounts] = await Promise.all([
    pocketLedgers(ctx, todayOn),
    getDb()
      .select()
      .from(pocketPlannedExpenses)
      .where(userScoped(ctx).owns(pocketPlannedExpenses))
      .orderBy(asc(pocketPlannedExpenses.dueOn), asc(pocketPlannedExpenses.id)),
    listAccounts(ctx, { includeArchived: true }),
  ]);
  const accountName = accountNames(accounts);
  const nameOf = (id: string | null) => (id === null ? null : (accountName.get(id) ?? null));
  const backingIds = [
    ...new Set(ledgers.flatMap(({ pocket }) => (pocket.backingAccountId ? [pocket.backingAccountId] : []))),
  ];
  const [balances, accrued] = await Promise.all([
    readingsAt(ctx, backingIds, todayOn),
    accruedInterestByAccount(ctx, backingIds, addDays(todayOn, -364), todayOn),
  ]);

  const views: PocketView[] = ledgers.map(({ pocket, own, spent, ledger, balanceCents }) => {
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
    const account = pocket.backingAccountId;
    const interestCents =
      account === null
        ? null
        : splitInterest(accrued.get(account) ?? null, balances.get(account) ?? null, balanceCents);
    return {
      pocket,
      accountName: nameOf(account),
      balanceCents,
      percent: targetPercent(balanceCents, pocket.targetCents),
      budgetCents: pocketBudget(ledger),
      accruedCents: pocketBalance(own.filter((movement) => movement.kind === "accrual")),
      spentCents: -spent.reduce<Cents>((sum, row) => sum + row.cents, 0n),
      history: monthEndBalances(ledger, months),
      expenses: spent.map(({ accountId, ...expense }) => ({ ...expense, accountName: nameOf(accountId) })),
      planned: upcoming,
      plannedCents,
      projectedCents: balanceCents - plannedCents,
      eta: etaMonths(pocket.targetCents, balanceCents, pocket.monthlyCents),
      interestCents,
      interestReason:
        account === null ? "standalone" : interestCents === null ? "no_interest_data" : "estimate",
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
    monthlyCents: monthlyOf(ledgers.map(({ pocket }) => pocket)),
    nextAccrual: addMonths(thisMonth, 1),
    accounts: accountOptions(accounts),
  };
}

/** What the active pockets are given each month. */
function monthlyOf(open: readonly Pocket[]): Cents {
  return open
    .filter((pocket) => pocket.state === "active")
    .reduce<Cents>((sum, pocket) => sum + (pocket.monthlyCents ?? 0n), 0n);
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
  const accountName = accountNames(accounts);
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
  const balances = await pocketBalances(ctx);
  return {
    totalCents: pocketBalance(balances.map((row) => ({ amountCents: row.balanceCents }))),
    monthlyCents: monthlyOf(balances.map((row) => row.pocket)),
    count: balances.length,
  };
}

/**
 * The open pockets' names, by name: all of them, or those resting on one account. Names are unique
 * per person (`pockets_user_name_uq`), so the order is the same whatever breaks a tie.
 */
function openPocketNames(ctx: Pick<Ctx, "userId">, accountId?: string) {
  return getDb()
    .select({ id: pockets.id, name: pockets.name })
    .from(pockets)
    .where(
      and(
        userScoped(ctx).owns(pockets),
        ne(pockets.state, "archived"),
        accountId === undefined ? undefined : eq(pockets.backingAccountId, accountId),
      ),
    )
    .orderBy(asc(pockets.name), asc(pockets.id));
}

/** The open pockets resting on an account, for Account detail (design: "Pockets" row). */
export async function pocketsOnAccount(
  ctx: Pick<Ctx, "userId">,
  accountId: string,
): Promise<{ id: string; name: string }[]> {
  return openPocketNames(ctx, accountId);
}

/** Pockets by name, for the ⌘K palette (spec §8.2). */
export async function searchPockets(
  ctx: Pick<Ctx, "userId">,
  term: string,
): Promise<{ id: string; name: string }[]> {
  const needle = term.trim().toLocaleLowerCase();
  if (needle === "") return [];
  const rows = await openPocketNames(ctx);
  return rows.filter((row) => row.name.toLocaleLowerCase().includes(needle)).slice(0, 5);
}
