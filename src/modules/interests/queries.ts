import "server-only";
import { and, asc, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { listAccounts } from "@/modules/accounts/queries";
import { incomeCandidates } from "@/modules/transactions/queries";
import { listCategories } from "@/modules/transactions/taxonomy";
import { payeeKeyOf } from "@/modules/transactions/rules";
import type { Ctx } from "@/platform/context";
import { addDays, type CivilDate, today } from "@/platform/dates";
import { getDb } from "@/platform/db/client";
import { userScoped } from "@/platform/db/scope";
import type { Cents } from "@/platform/money";
import {
  assignPayments,
  fixedFromDecimal,
  isFreshReading,
  paymentWindow,
  paysInterest,
  periodOf,
  reconcile,
  type ReconciliationStatus,
  roundToCents,
  type Tier,
} from "./rules";
import { interestAccruals, interestEntries, interestRules } from "./schema";
import {
  type InterestAccrual,
  type InterestEntry,
  type InterestRule,
  InterestError,
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

/** The Interests table (spec §7.6, design): every rule with its year to date and next payout. */
export async function interestsView(
  ctx: Pick<Ctx, "userId" | "timeZone">,
  now: Date = new Date(),
): Promise<RuleRow[]> {
  const todayOn = today(ctx.timeZone, now);
  const yearStart = `${todayOn.slice(0, 4)}-01-01`;
  const [rules, accounts] = await Promise.all([
    getDb()
      .select()
      .from(interestRules)
      .where(userScoped(ctx).owns(interestRules))
      .orderBy(asc(interestRules.validFrom), asc(interestRules.id)),
    listAccounts(ctx, { includeArchived: true }),
  ]);
  const ids = rules.map((rule) => rule.id);
  const [tiers, sums] = await Promise.all([
    tiersOf(ctx, ids),
    ids.length === 0
      ? []
      : getDb()
          .select({
            ruleId: interestAccruals.ruleId,
            net: sql<string>`coalesce(sum(${interestAccruals.netCents}), 0)`,
            gross: sql<string>`coalesce(sum(${interestAccruals.gross}), 0)`,
          })
          .from(interestAccruals)
          .where(
            and(
              userScoped(ctx).owns(interestAccruals),
              inArray(interestAccruals.ruleId, ids),
              gte(interestAccruals.on, yearStart),
            ),
          )
          .groupBy(interestAccruals.ruleId),
  ]);
  const accountName = new Map(accounts.map((account) => [account.id, account.name]));
  const sumOf = new Map(sums.map((row) => [row.ruleId, row]));
  return rules.map((rule) => {
    const period = periodOf(rule.settlement, todayOn);
    const running = rule.state === "active" && (rule.validTo === null || rule.validTo >= todayOn);
    const end = rule.validTo !== null && rule.validTo < period.to ? rule.validTo : period.to;
    const sum = sumOf.get(rule.id);
    return {
      rule,
      tiers: tiers.get(rule.id) ?? [],
      accountName: accountName.get(rule.accountId) ?? "",
      accruedYtdCents: BigInt(sum?.net ?? "0"),
      grossYtdCents: roundToCents(fixedFromDecimal(sum?.gross ?? "0")),
      nextPayout: running ? addDays(end, 1) : null,
    };
  });
}

export interface SettlementRow {
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
export interface BalanceState {
  synced: boolean;
  lastSyncedAt: Date | null;
  stale: boolean;
}

export interface RuleDetail {
  rule: InterestRule;
  tiers: Tier[];
  accountName: string;
  /** The category each published settlement is filed under in Wallet; `null` for none. */
  categoryName: string | null;
  balance: BalanceState;
  settlements: SettlementRow[];
  /** The latest days, newest first, skipped ones included. */
  days: InterestAccrual[];
  /** Net accrued in the period under way, not settled yet. */
  pendingCents: Cents;
}

/**
 * One rule's page (plan F4 §3.6.12): its settlements, each reconciled with what was really paid
 * (spec §7.6), and its day ledger. In `post_to_provider` the paid amount is the posted settlement;
 * otherwise it is the account's income in the payment window whose payee, category or note contains
 * the rule's match text (plan F4 §3.6.1).
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
  const [tiers, accounts, categories, entries, days, counts, pending] = await Promise.all([
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
    getDb()
      .select({
        entryId: interestAccruals.entryId,
        accrued: sql<number>`count(*) filter (where ${interestAccruals.status} = 'accrued')`,
        skipped: sql<number>`count(*) filter (where ${interestAccruals.status} <> 'accrued')`,
      })
      .from(interestAccruals)
      .where(and(eq(interestAccruals.ruleId, id), userScoped(ctx).owns(interestAccruals)))
      .groupBy(interestAccruals.entryId),
    getDb()
      .select({ net: sql<string>`coalesce(sum(${interestAccruals.netCents}), 0)` })
      .from(interestAccruals)
      .where(
        and(
          eq(interestAccruals.ruleId, id),
          userScoped(ctx).owns(interestAccruals),
          sql`${interestAccruals.entryId} is null`,
        ),
      ),
  ]);
  const countOf = new Map(counts.map((row) => [row.entryId, row]));
  const needle = payeeKeyOf(rule.payeeMatch);

  // The bank's payments, read once for every window and each counted for one settlement only
  // (plan F4 §3.4.5): windows overlap, and a daily payout's overlap every day.
  const windows = entries.map((entry) => ({
    entry,
    window: paymentWindow(rule.settlement, { to: entry.periodTo, settleOn: entry.settleOn }),
  }));
  const payments =
    rule.mode === "post_to_provider" || needle === null || windows.length === 0
      ? []
      : (
          await incomeCandidates(ctx, {
            accountId: rule.accountId,
            from: windows.reduce(
              (first, one) => (one.window.from < first ? one.window.from : first),
              windows[0].window.from,
            ),
            to: todayOn,
          })
        ).filter((row) => paysInterest(rule.payeeMatch, row));
  const assigned = assignPayments(
    rule.settlement,
    entries.map((entry) => ({ id: entry.id, to: entry.periodTo, settleOn: entry.settleOn })),
    payments,
  );
  const amountOf = new Map(payments.map((payment) => [payment.id, payment.cents]));

  const settlements: SettlementRow[] = windows.map(({ entry, window }) => {
    const paidCents: Cents | null =
      rule.mode === "post_to_provider"
        ? entry.posting === "posted"
          ? entry.netCents
          : 0n
        : needle === null
          ? null
          : (assigned.get(entry.id) ?? []).reduce<Cents>(
              (sum, paymentId) => sum + (amountOf.get(paymentId) ?? 0n),
              0n,
            );
    const count = countOf.get(entry.id);
    const accruedDays = Number(count?.accrued ?? 0);
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

  const account = accounts.find((one) => one.id === rule.accountId) ?? null;
  const synced = account?.origin === "synced" && account.providerAccountId !== null;
  return {
    rule,
    tiers: tiers.get(id) ?? [],
    accountName: account?.name ?? "",
    categoryName:
      rule.postingCategoryId === null
        ? null
        : (categories.find((one) => one.id === rule.postingCategoryId)?.name ?? null),
    balance: {
      synced,
      lastSyncedAt: account?.lastSyncedAt ?? null,
      stale: synced && !isFreshReading(account?.lastSyncedAt ?? null, now),
    },
    settlements,
    days,
    pendingCents: BigInt(pending[0]?.net ?? "0"),
  };
}

/** The rules on an account, for Account detail's "Interest rule" row (design). */
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
