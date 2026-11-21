// The read-model of a request (audit INV-4): every book of the person, valued, loaded once.
import { type Account, listAccounts } from "../../accounts";
import type { Ctx } from "../../../platform/context";
import { type CivilDate, today } from "../../../shared/dates";
import { type RateTable } from "../../../platform/fx/rules";
import { type DayValue, valueAt } from "../rules";
import { type InvestmentAccount, listInvestmentAccounts, type LoadedBook, valuedBook } from "../service";
import { type SyncStatus, syncStatus } from "../sync";

// ——— The read-model of a request (audit INV-4) ——————————————————————————————————————————————————
// Every book of the person, valued, loaded once: the portfolio, the P&L, the positions, the home and
// a service's views all derive from one snapshot, so a page or a route that shows two of them reads
// the books once.

/** One service of the snapshot: its book, the rates that value it, and its value today. */
export interface Loaded {
  account: Account;
  investment: InvestmentAccount;
  book: LoadedBook;
  rates: RateTable;
  day: DayValue;
  sync: SyncStatus | null;
}

/** The person's services as one request reads them, valued on `todayOn`. */
export interface InvestmentsSnapshot {
  /** The instant the snapshot was read at, and its day in the person's time zone. */
  now: Date;
  todayOn: CivilDate;
  /** Every service, the archived ones too; only the one asked when the snapshot was loaded for it. */
  loaded: Loaded[];
  /** Every account of the person, the archived ones too: the names and the order of Overview. */
  accounts: Account[];
}

/**
 * Loads the snapshot of a request: every service, or only the one of `accountId`, with its book,
 * its rates and its value today (`valueAt`), and the state of its sync.
 */
export async function investmentsSnapshot(
  ctx: Pick<Ctx, "userId" | "timeZone">,
  options: { now?: Date; accountId?: string } = {},
): Promise<InvestmentsSnapshot> {
  const now = options.now ?? new Date();
  const todayOn = today(ctx.timeZone, now);
  const [investments, accounts] = await Promise.all([
    listInvestmentAccounts(ctx),
    listAccounts(ctx, { includeArchived: true }),
  ]);
  const byId = new Map(accounts.map((account) => [account.id, account]));
  const loaded: Loaded[] = [];
  for (const investment of investments) {
    if (options.accountId !== undefined && investment.accountId !== options.accountId) continue;
    const account = byId.get(investment.accountId);
    if (!account) continue;
    const { book, rates } = await valuedBook(ctx, investment, { currency: account.currency, todayOn });
    const day = valueAt(book, todayOn, rates);
    // Also after a disconnection: the retired key still asks to be revoked (SEC-07).
    const sync = await syncStatus(ctx, investment);
    loaded.push({ account, investment, book, rates, day, sync });
  }
  return { now, todayOn, loaded, accounts };
}

/** The snapshot a view reads: the one given, or one loaded now (for `accountId` alone when given). */
export async function snapshotOf(
  ctx: Pick<Ctx, "userId" | "timeZone">,
  source: Date | InvestmentsSnapshot,
  accountId?: string,
): Promise<InvestmentsSnapshot> {
  return source instanceof Date ? investmentsSnapshot(ctx, { now: source, accountId }) : source;
}

/** The services of the snapshot: every one, or the one of `accountId`. */
export function servicesOf(snapshot: InvestmentsSnapshot, accountId?: string): Loaded[] {
  return accountId === undefined
    ? snapshot.loaded
    : snapshot.loaded.filter((one) => one.investment.accountId === accountId);
}
