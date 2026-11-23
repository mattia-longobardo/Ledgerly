// Accounts (rewrite plan R2, 05-refactor.md §5.5): every route of the module. What is the domain's
// is called here; the compositions the web process still holds (the deletion that joins six
// modules, the switch to a bank with its registry, the monthly figures) are lent by it
// (`AccountCases`), like the guard, until R4.
import type { Hono } from "hono";
import type { z } from "zod";
import { ACCOUNTS, type RouteContract } from "@ledgerly/api-contract";
import {
  addConnection,
  changeBetween,
  archiveAccount,
  readingsAt,
  connectionsOf,
  createAccount,
  deleteBalanceEntry,
  getAccount,
  listAccounts,
  listBalanceEntries,
  listSnapshotRuns,
  removeConnection,
  restoreAccount,
  runSnapshot,
  twinAccount,
  saveBalanceEntry,
  snapshotMonthFor,
  updateAccountSettings,
  updateBalanceEntry,
  updateConnection,
  type Account,
} from "@ledgerly/domain/accounts";
import type { Ctx } from "@ledgerly/domain/platform/context";
import { incomeLessExpense } from "@ledgerly/domain/transactions";
import { fundsByAccount } from "@ledgerly/domain/funds";
import { groupIban } from "@ledgerly/domain/platform/iban";
import { monthKey, today } from "@ledgerly/domain/shared/dates";
import { type Cents, parseCents } from "@ledgerly/domain/shared/money";
import { type ApiEnv, ApiRefusal, type Guard, serve } from "../serve";
import { accountRefusal, refusing } from "./cases";
import { serveViews } from "./views";
import { accountDetail, accountRow, balanceEntry, delta, money, moneyOf, snapshot } from "./dto";

const { accounts, balances, links, removal, switch: switching, summary, views } = ACCOUNTS;

type Wire<T extends z.ZodType> = z.input<T>;

type Failure = { ok: false; error: string; retryAt?: string | null };
type Outcome<T> = ({ ok: true } & T) | Failure;
type Target = { connectionId: string; bankAccountId: string };

/** The monthly figures (`platform/reports/monthly`): one source for the card, the mail and MCP. */
export interface MonthlyFigures {
  month: string;
  currency: string;
  netWorthCents: Cents | null;
  netWorthPartial: boolean;
  previousNetWorthCents: Cents | null;
  cashCents: Cents | null;
  cashPartial: boolean;
  incomeCents: Cents;
  expenseCents: Cents;
  netCents: Cents;
  /** The movements income, expense and net left out for want of a rate (D4); absent when none. */
  excludedCount?: number;
  transactions: number;
  accounts: number;
  lastSnapshotMonth: string | null;
}

/** What the web process lends until R4: the Server Actions call the same use cases. */
export interface AccountCases {
  figures(ctx: Ctx): Promise<MonthlyFigures>;
  dependents(ctx: Ctx, id: string): Promise<Outcome<z.input<typeof removal.listAccountDependents.response>>>;
  moveDependent(
    ctx: Ctx,
    input: { accountId: string; kind: string; id: string; to: string },
  ): Promise<Outcome<object>>;
  deleteAccount(ctx: Ctx, id: string): Promise<Outcome<object>>;
  checkSwitch(
    ctx: Ctx,
    id: string,
    target: Target,
    headers: Headers,
  ): Promise<Outcome<{ report: z.input<typeof switching.checkAccountSwitch.response> }>>;
  applySwitch(
    ctx: Ctx,
    id: string,
    target: Target & { fingerprint: string },
    headers: Headers,
  ): Promise<Outcome<{ matched: number; transfers: number; fresh: number }>>;
  undoSwitch(ctx: Ctx, id: string): Promise<Outcome<object>>;
  /** What the account's page shows around its figures (the registry of providers is the web's). */
  context(ctx: Ctx, id: string): Promise<Outcome<{ context: Wire<typeof views.getAccountContext.response> }>>;
  /** The step «Account» of the switch: the accounts of the banks, with the IBAN as two flags only. */
  switchCandidates(
    ctx: Ctx,
    id: string,
  ): Promise<Outcome<{ candidates: Wire<typeof switching.listSwitchCandidates.response> }>>;
  /** The same candidates' identifiers, masked: the web's session only (H45). */
  switchIdentifiers(
    ctx: Ctx,
    id: string,
  ): Promise<Outcome<{ identifiers: Wire<typeof switching.listSwitchIdentifiers.response> }>>;
}

/** A refusal of a use case of the web as the contract names it. */
function settled<T>(outcome: Outcome<T>): T {
  if (outcome.ok) return outcome;
  if (outcome.error === "not_found") throw new ApiRefusal("not_found");
  if (outcome.error === "rate_limited") throw new ApiRefusal("rate_limited", outcome.retryAt ?? undefined);
  throw new ApiRefusal("conflict", outcome.error);
}

const cents = (amount: string): Cents => parseCents(amount);

/** The account as `GET /accounts/{id}` answers it: with the fund whose value it holds (R5b). */
async function detailOf(ctx: Ctx, account: Account) {
  return accountDetail(account, (await fundsByAccount(ctx)).get(account.id)?.id ?? null);
}

async function requireOwn(ctx: Ctx, id: string) {
  const account = await getAccount(ctx, id);
  if (!account) throw new ApiRefusal("not_found");
  return account;
}

/** `limit` of the history: 1-200, and 200 when missing or not a number, as since F8 (API-3). */
function historyLimit(raw: string | undefined): number {
  const limit = Number(raw);
  return Number.isInteger(limit) && limit >= 1 && limit <= 200 ? limit : 200;
}

function serveAccountsProper(app: Hono<ApiEnv>, guard: Guard): void {
  serve(app, guard, accounts.listAccounts, async ({ ctx, query }) => {
    const rows = await listAccounts(ctx, { includeArchived: query.archived === "true" });
    const latest = await readingsAt(
      ctx,
      rows.map((account) => account.id),
      today(ctx.timeZone),
    );
    return { accounts: rows.map((account) => accountRow(account, latest.get(account.id) ?? null)) };
  });
  serve(app, guard, accounts.getAccount, async ({ ctx, params }) =>
    detailOf(ctx, await requireOwn(ctx, params.id)),
  );
  // Scope `session` (H45): only the web's own session reaches this handler.
  serve(app, guard, accounts.getAccountIban, async ({ ctx, params }) => {
    const { iban } = await requireOwn(ctx, params.id);
    return { iban: iban === null ? null : groupIban(iban) };
  });
  serve(app, guard, accounts.createAccount, async ({ ctx, body }) => {
    const { openingBalance, ...rest } = body;
    const account = await refusing(
      createAccount(ctx, {
        ...rest,
        openingBalance: openingBalance
          ? { on: openingBalance.on, cents: cents(openingBalance.amount) }
          : null,
      }),
    );
    return detailOf(ctx, account);
  });
  serve(app, guard, accounts.updateAccount, async ({ ctx, params, body }) => {
    const current = await requireOwn(ctx, params.id);
    const { lowBalance, ...rest } = body;
    // A field left out keeps its value; the IBAN is kept as stored, never sent back (H45).
    await refusing(
      updateAccountSettings(ctx, params.id, {
        name: current.name,
        type: current.type,
        currency: current.currency,
        groupId: current.groupId,
        color: current.color,
        reference: current.reference,
        iban: current.iban,
        purpose: current.purpose,
        openedOn: current.openedOn,
        notes: current.notes,
        inNetWorth: current.inNetWorth,
        inSnapshot: current.inSnapshot,
        countsAsLiquid: current.countsAsLiquid,
        lowBalanceCents:
          lowBalance === undefined ? current.lowBalanceCents : lowBalance === null ? null : cents(lowBalance),
        staleAfterHours: current.staleAfterHours,
        reminder: current.reminder,
        betweenEntries: current.betweenEntries,
        ...rest,
      }),
    );
    return detailOf(ctx, await requireOwn(ctx, params.id));
  });
  serve(app, guard, accounts.archiveAccount, ({ ctx, params }) => refusing(archiveAccount(ctx, params.id)));
  serve(app, guard, accounts.restoreAccount, ({ ctx, params }) => refusing(restoreAccount(ctx, params.id)));
}

function serveBalances(app: Hono<ApiEnv>, guard: Guard): void {
  serve(app, guard, balances.getAccountBalances, async ({ ctx, params, query }) => {
    await requireOwn(ctx, params.id);
    const limit = historyLimit(query.limit);
    // One more than asked: the oldest entry answered has a change too, from the one before it.
    const entries = await listBalanceEntries(ctx, params.id, limit + 1);
    return {
      balances: entries.slice(0, limit).map((entry, index) => ({
        ...balanceEntry(entry),
        change: delta(changeBetween(entry.balanceCents, entries[index + 1]?.balanceCents ?? null)),
      })),
    };
  });
  serve(app, guard, balances.recordAccountBalance, async ({ ctx, params, body }) => {
    try {
      const entry = await saveBalanceEntry(ctx, params.id, {
        on: body.on,
        cents: cents(body.balance),
        availableCents: body.available == null ? null : cents(body.available),
        note: body.note ?? "",
      });
      return { id: entry.id, on: entry.on, balance: moneyOf(entry.balanceCents), source: entry.source };
    } catch (error) {
      // Since F8 every refusal but a missing account is `400`: the code is in `reason`.
      const refusal = accountRefusal(error);
      if (refusal instanceof ApiRefusal && refusal.code === "conflict")
        throw new ApiRefusal("invalid", refusal.reason);
      throw refusal;
    }
  });
  serve(app, guard, balances.updateBalanceEntry, async ({ ctx, params, body }) => {
    await requireOwn(ctx, params.id);
    const entry = await refusing(
      updateBalanceEntry(
        ctx,
        params.entryId,
        {
          on: body.on,
          cents: cents(body.balance),
          availableCents: body.available == null ? null : cents(body.available),
          note: body.note ?? "",
        },
        params.id,
      ),
    );
    return balanceEntry(entry);
  });
  serve(app, guard, balances.deleteBalanceEntry, async ({ ctx, params }) => {
    await requireOwn(ctx, params.id);
    await refusing(deleteBalanceEntry(ctx, params.entryId, params.id));
  });
}

function serveLinks(app: Hono<ApiEnv>, guard: Guard): void {
  const link = (row: { id: string; channel: "iban" | "card"; name: string; note: string | null }) => ({
    id: row.id,
    channel: row.channel,
    name: row.name,
    note: row.note,
  });
  serve(app, guard, links.listAccountLinks, async ({ ctx, params }) => {
    await requireOwn(ctx, params.id);
    return { links: (await connectionsOf(ctx, params.id)).map(link) };
  });
  serve(app, guard, links.addAccountLink, async ({ ctx, params, body }) =>
    link(await refusing(addConnection(ctx, params.id, body))),
  );
  serve(app, guard, links.updateAccountLink, async ({ ctx, params, body }) => {
    const owned = (await connectionsOf(ctx, params.id)).some((row) => row.id === params.linkId);
    if (!owned) throw new ApiRefusal("not_found");
    return link(await refusing(updateConnection(ctx, params.linkId, body)));
  });
  serve(app, guard, links.removeAccountLink, async ({ ctx, params }) => {
    const owned = (await connectionsOf(ctx, params.id)).some((row) => row.id === params.linkId);
    if (owned) await refusing(removeConnection(ctx, params.linkId));
  });
}

function serveFigures(app: Hono<ApiEnv>, guard: Guard, cases: AccountCases): void {
  serve(app, guard, summary.getSummary, async ({ ctx }) => {
    const figures = await cases.figures(ctx);
    return {
      month: figures.month,
      currency: figures.currency,
      netWorth: money(figures.netWorthCents),
      netWorthPartial: figures.netWorthPartial,
      previousNetWorth: money(figures.previousNetWorthCents),
      cash: money(figures.cashCents),
      cashPartial: figures.cashPartial,
      income: moneyOf(figures.incomeCents),
      expense: moneyOf(figures.expenseCents),
      net: moneyOf(figures.netCents),
      incomeLessExpense: moneyOf(incomeLessExpense(figures)),
      ...(figures.excludedCount === undefined ? {} : { excludedCount: figures.excludedCount }),
      transactions: figures.transactions,
      accounts: figures.accounts,
      lastSnapshotMonth: figures.lastSnapshotMonth,
    };
  });
  serve(app, guard, summary.listSnapshots, async ({ ctx }) => ({
    snapshots: (await listSnapshotRuns(ctx)).map(snapshot),
  }));
  serve(app, guard, summary.runSnapshot, async ({ ctx, body }) => {
    const month = body.on ? monthKey(body.on) : snapshotMonthFor(today(ctx.timeZone));
    await refusing(runSnapshot(ctx, month));
    const run = (await listSnapshotRuns(ctx)).find((one) => one.month === month);
    if (!run) throw new ApiRefusal("invalid");
    return snapshot(run);
  });
}

function serveRemovalAndSwitch(app: Hono<ApiEnv>, guard: Guard, cases: AccountCases): void {
  serve(app, guard, views.getAccountContext, async ({ ctx, params }) => {
    await requireOwn(ctx, params.id);
    return settled(await cases.context(ctx, params.id)).context;
  });
  serve(app, guard, switching.listSwitchCandidates, async ({ ctx, params }) => {
    await requireOwn(ctx, params.id);
    return settled(await cases.switchCandidates(ctx, params.id)).candidates;
  });
  serve(app, guard, switching.listSwitchIdentifiers, async ({ ctx, params }) => {
    await requireOwn(ctx, params.id);
    return settled(await cases.switchIdentifiers(ctx, params.id)).identifiers;
  });
  serve(app, guard, removal.listAccountDependents, async ({ ctx, params }) => {
    const { dependents, targets } = settled(await cases.dependents(ctx, params.id));
    return { dependents, targets };
  });
  serve(app, guard, removal.moveAccountDependent, async ({ ctx, params, body }) => {
    settled(await cases.moveDependent(ctx, { accountId: params.id, ...body }));
  });
  serve(app, guard, removal.deleteAccount, async ({ ctx, params }) => {
    settled(await cases.deleteAccount(ctx, params.id));
  });
  serve(app, guard, switching.checkAccountSwitch, async ({ ctx, params, body, headers }) => {
    return settled(await cases.checkSwitch(ctx, params.id, body, headers)).report;
  });
  serve(app, guard, switching.applyAccountSwitch, async ({ ctx, params, body, headers }) => {
    const { matched, transfers, fresh } = settled(await cases.applySwitch(ctx, params.id, body, headers));
    return { matched, transfers, fresh };
  });
  serve(app, guard, switching.undoAccountSwitch, async ({ ctx, params }) => {
    settled(await cases.undoSwitch(ctx, params.id));
  });
}

/** The account an account doubles (decision H58): what the dialog of "Archive" reads first. */
function serveTwin(app: Hono<ApiEnv>, guard: Guard): void {
  serve(app, guard, accounts.getAccountTwin, async ({ ctx, params }) => {
    await requireOwn(ctx, params.id);
    const twin = await twinAccount(ctx, params.id);
    return { twin: twin === null ? null : { id: twin.id, name: twin.name } };
  });
}

/** Every route of accounts; `/meta` lists their capability. */
export function serveAccounts(
  app: Hono<ApiEnv>,
  guard: Guard,
  cases: AccountCases,
): readonly RouteContract[] {
  serveAccountsProper(app, guard);
  serveTwin(app, guard);
  serveBalances(app, guard);
  serveLinks(app, guard);
  serveFigures(app, guard, cases);
  serveViews(app, guard);
  serveRemovalAndSwitch(app, guard, cases);
  return [
    ...Object.values(accounts),
    ...Object.values(balances),
    ...Object.values(links),
    ...Object.values(summary),
    ...Object.values(views),
    ...Object.values(removal),
    ...Object.values(switching),
  ];
}
