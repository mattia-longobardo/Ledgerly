import { and, asc, desc, eq, sql } from "drizzle-orm";
import { type Account, accountNames, listAccounts } from "../accounts";
import { findMovements } from "../transactions/queries";
import { listCategories } from "../transactions/taxonomy";
import { payeeKeyOf } from "../transactions/rules";
import type { Ctx } from "../../platform/context";
import { coreCreatesRecords, listConnections } from "../../platform/integrations";
import { addDays, type CivilDate, today } from "../../shared/dates";
import { getDb } from "../../platform/db/client";
import { userScoped } from "../../platform/db/scope";
import type { Cents } from "../../shared/money";
import {
  assignPayments,
  isFreshReading,
  paymentWindow,
  paysInterest,
  periodOf,
  reconcile,
  type ReconciliationStatus,
  type Tier,
} from "./rules";
import { interestAccruals, interestEntries, interestRules } from "./schema";
import {
  type AccrualSum,
  type InterestAccrual,
  type InterestEntry,
  type InterestRule,
  InterestError,
  sumAccruals,
  tiersOf,
} from "./service";

export interface RuleRow {
  rule: InterestRule;
  tiers: Tier[];
  accountName: string;
  /** Net accrued since 1 January. */
  accruedYtdCents: Cents;
  /** Gross accrued since 1 January, rounded once. */
  grossYtdCents: Cents;
  /** The day the period under way settles; `null` for a paused or ended rule. */
  nextPayout: CivilDate | null;
}

/** A rule with its sums since 1 January (INT-4: `sumAccruals`) and its next payout. */
function ruleRow(
  rule: InterestRule,
  parts: { tiers: Tier[]; accountName: string; sum: AccrualSum | undefined; todayOn: CivilDate },
): RuleRow {
  const period = periodOf(rule.settlement, parts.todayOn);
  const running = rule.state === "active" && (rule.validTo === null || rule.validTo >= parts.todayOn);
  const end = rule.validTo !== null && rule.validTo < period.to ? rule.validTo : period.to;
  return {
    rule,
    tiers: parts.tiers,
    accountName: parts.accountName,
    accruedYtdCents: parts.sum?.netCents ?? 0n,
    grossYtdCents: parts.sum?.grossCents ?? 0n,
    nextPayout: running ? addDays(end, 1) : null,
  };
}

const yearStartOf = (day: CivilDate): CivilDate => `${day.slice(0, 4)}-01-01`;

/** The Interests table (spec §7.6, design): every rule with its year to date and next payout. */
export async function interestsView(
  ctx: Pick<Ctx, "userId" | "timeZone">,
  now: Date = new Date(),
): Promise<RuleRow[]> {
  const todayOn = today(ctx.timeZone, now);
  const [rules, accounts] = await Promise.all([
    getDb()
      .select()
      .from(interestRules)
      .where(userScoped(ctx).owns(interestRules))
      .orderBy(asc(interestRules.validFrom), asc(interestRules.id)),
    listAccounts(ctx, { includeArchived: true }),
  ]);
  if (rules.length === 0) return [];
  const ruleIds = rules.map((rule) => rule.id);
  const [tiers, sums] = await Promise.all([
    tiersOf(ctx, ruleIds),
    sumAccruals(ctx, "rule", { ruleIds, from: yearStartOf(todayOn) }),
  ]);
  const accountName = accountNames(accounts);
  return rules.map((rule) =>
    ruleRow(rule, {
      tiers: tiers.get(rule.id) ?? [],
      accountName: accountName.get(rule.accountId) ?? "",
      sum: sums.get(rule.id),
      todayOn,
    }),
  );
}

interface SettlementRow {
  entry: InterestEntry;
  accruedDays: number;
  skippedDays: number;
  /** What the bank paid for it, or what was published; `null` when there is no way to tell. */
  paidCents: Cents | null;
  status: ReconciliationStatus;
}

/**
 * Where the rule's balance stands (spec §7.6): a synced account whose last reading is too old is
 * one the accrual job refuses to accrue on, so the page says the accrual is on hold instead of
 * leaving the person to wonder why the days stopped. Read here rather than stored: the moment a
 * pass brings a reading, the warning is gone and the next tick catches the days up.
 */
interface BalanceState {
  synced: boolean;
  lastSyncedAt: Date | null;
  stale: boolean;
}

interface RuleDetail extends RuleRow {
  /** The category each published settlement is filed under on the source; `null` for none. */
  categoryName: string | null;
  balance: BalanceState;
  settlements: SettlementRow[];
  /** The latest days, newest first, skipped ones included. */
  days: InterestAccrual[];
  /** Net accrued in the period under way, not settled yet. */
  pendingCents: Cents;
  /**
   * The rule page's own year to date: the settlements that start this year, plus what is pending.
   * Not `accruedYtdCents` while days of last year wait for their settlement (kept apart: V.2).
   */
  pageYtdCents: Cents;
}

/** How many days of each settlement accrued and how many were skipped. */
async function dayCounts(ctx: Pick<Ctx, "userId">, ruleId: string) {
  const rows = await getDb()
    .select({
      entryId: interestAccruals.entryId,
      accrued: sql<number>`count(*) filter (where ${interestAccruals.status} = 'accrued')`,
      skipped: sql<number>`count(*) filter (where ${interestAccruals.status} <> 'accrued')`,
    })
    .from(interestAccruals)
    .where(and(eq(interestAccruals.ruleId, ruleId), userScoped(ctx).owns(interestAccruals)))
    .groupBy(interestAccruals.entryId);
  return new Map(rows.map((row) => [row.entryId, row]));
}

/**
 * What the bank paid for each settlement (plan F4 §3.4.5): its income in the payment windows whose
 * payee, category or note contains the rule's match text, read once for every window and each payment
 * counted for one settlement only — windows overlap, and a daily payout's overlap every day.
 */
async function paidBySettlement(
  ctx: Pick<Ctx, "userId" | "timeZone">,
  rule: InterestRule,
  entries: readonly InterestEntry[],
  todayOn: CivilDate,
): Promise<Map<string, Cents>> {
  const windows = entries.map((entry) =>
    paymentWindow(rule.settlement, { to: entry.periodTo, settleOn: entry.settleOn }),
  );
  if (windows.length === 0) return new Map();
  const payments = (
    await findMovements(ctx, {
      types: ["income"],
      accountIds: [rule.accountId],
      from: windows.reduce((first, one) => (one.from < first ? one.from : first), windows[0].from),
      to: todayOn,
    })
  ).filter((row) => paysInterest(rule.payeeMatch, row));
  const assigned = assignPayments(
    rule.settlement,
    entries.map((entry) => ({ id: entry.id, to: entry.periodTo, settleOn: entry.settleOn })),
    payments,
  );
  const amountOf = new Map(payments.map((payment) => [payment.id, payment.cents]));
  return new Map(
    entries.map((entry) => [
      entry.id,
      (assigned.get(entry.id) ?? []).reduce<Cents>(
        (sum, paymentId) => sum + (amountOf.get(paymentId) ?? 0n),
        0n,
      ),
    ]),
  );
}

/**
 * Each settlement reconciled with what was really paid (spec §7.6). In `post_to_provider` the paid
 * amount is the posted settlement; otherwise what the bank paid, `null` without a match text.
 */
async function settlementRows(
  ctx: Pick<Ctx, "userId" | "timeZone">,
  rule: InterestRule,
  entries: readonly InterestEntry[],
  todayOn: CivilDate,
): Promise<SettlementRow[]> {
  const publishes = rule.mode === "post_to_provider";
  const looked = !publishes && payeeKeyOf(rule.payeeMatch) !== null;
  const [counts, paid] = await Promise.all([
    dayCounts(ctx, rule.id),
    looked ? paidBySettlement(ctx, rule, entries, todayOn) : new Map<string, Cents>(),
  ]);
  return entries.map((entry) => {
    const posted = entry.posting === "posted" ? entry.netCents : 0n;
    const paidCents = publishes ? posted : looked ? (paid.get(entry.id) ?? 0n) : null;
    const count = counts.get(entry.id);
    const accruedDays = Number(count?.accrued ?? 0);
    const window = paymentWindow(rule.settlement, { to: entry.periodTo, settleOn: entry.settleOn });
    return {
      entry,
      accruedDays,
      skippedDays: Number(count?.skipped ?? 0),
      paidCents,
      status: reconcile({
        accruedDays,
        accruedCents: entry.netCents,
        paidCents,
        posting: entry.posting,
        windowOpen: todayOn <= window.to,
      }),
    };
  });
}

/** The balance the accrual reads, for the rule's page. */
function balanceOf(account: Account | null, now: Date): BalanceState {
  const synced = account?.origin === "synced" && account.providerAccountId !== null;
  const lastSyncedAt = account?.lastSyncedAt ?? null;
  return { synced, lastSyncedAt, stale: synced && !isFreshReading(lastSyncedAt, now) };
}

/**
 * One rule's page (plan F4 §3.6.12): its row, its settlements, each reconciled with what was really
 * paid (spec §7.6), and its day ledger.
 */
export async function ruleDetail(
  ctx: Pick<Ctx, "userId" | "timeZone">,
  id: string,
  now: Date = new Date(),
): Promise<RuleDetail> {
  const todayOn = today(ctx.timeZone, now);
  const [rule] = await getDb()
    .select()
    .from(interestRules)
    .where(and(eq(interestRules.id, id), userScoped(ctx).owns(interestRules)));
  if (!rule) throw new InterestError("not_found");
  const [tiers, accounts, categories, entries, days, sums] = await Promise.all([
    tiersOf(ctx, [id]),
    listAccounts(ctx, { includeArchived: true }),
    listCategories(ctx, { includeArchived: true }),
    getDb()
      .select()
      .from(interestEntries)
      .where(and(eq(interestEntries.ruleId, id), userScoped(ctx).owns(interestEntries)))
      .orderBy(desc(interestEntries.periodFrom)),
    getDb()
      .select()
      .from(interestAccruals)
      .where(and(eq(interestAccruals.ruleId, id), userScoped(ctx).owns(interestAccruals)))
      .orderBy(desc(interestAccruals.on))
      .limit(90),
    sumAccruals(ctx, "rule", { ruleIds: [id], from: yearStartOf(todayOn) }),
  ]);
  const account = accounts.find((one) => one.id === rule.accountId) ?? null;
  const sum = sums.get(id);
  const pendingCents = sum?.pendingCents ?? 0n;
  const year = todayOn.slice(0, 4);
  return {
    ...ruleRow(rule, { tiers: tiers.get(id) ?? [], accountName: account?.name ?? "", sum, todayOn }),
    categoryName:
      rule.postingCategoryId === null
        ? null
        : (categories.find((one) => one.id === rule.postingCategoryId)?.name ?? null),
    balance: balanceOf(account, now),
    settlements: await settlementRows(ctx, rule, entries, todayOn),
    days,
    pendingCents,
    pageYtdCents: entries
      .filter((entry) => entry.periodFrom.startsWith(year))
      .reduce((total, entry) => total + entry.netCents, pendingCents),
  };
}

/** The rules on an account, for Account detail's "Interest rule" row (design). */
/** How many rules of an account publish their settlements on its source (rewrite plan N4, §9.4). */
export async function publishingRulesOn(ctx: Pick<Ctx, "userId">, accountId: string): Promise<number> {
  const rows = await getDb()
    .select({ id: interestRules.id })
    .from(interestRules)
    .where(
      and(
        userScoped(ctx).owns(interestRules),
        eq(interestRules.accountId, accountId),
        eq(interestRules.mode, "post_to_provider"),
      ),
    );
  return rows.length;
}

export async function rulesOnAccount(
  ctx: Pick<Ctx, "userId">,
  accountId: string,
): Promise<{ id: string; tiers: Tier[] }[]> {
  const rules = await getDb()
    .select({ id: interestRules.id })
    .from(interestRules)
    .where(and(userScoped(ctx).owns(interestRules), eq(interestRules.accountId, accountId)))
    .orderBy(asc(interestRules.validFrom), asc(interestRules.id));
  const tiers = await tiersOf(
    ctx,
    rules.map((rule) => rule.id),
  );
  return rules.map((rule) => ({ id: rule.id, tiers: tiers.get(rule.id) ?? [] }));
}

/**
 * The open accounts a rule can be on, each saying whether a rule on it can publish: its source is
 * connected and writes (plugin-settings.md §2.2). What the rule dialog offers.
 */
export async function ruleAccounts(
  ctx: Pick<Ctx, "userId">,
): Promise<{ id: string; name: string; publishable: boolean }[]> {
  const [accounts, connections] = await Promise.all([listAccounts(ctx), listConnections(ctx)]);
  const connected = new Set(connections.map((connection) => connection.provider));
  return accounts.map((account) => ({
    id: account.id,
    name: account.name,
    publishable:
      account.provider !== null && coreCreatesRecords(account.provider) && connected.has(account.provider),
  }));
}
