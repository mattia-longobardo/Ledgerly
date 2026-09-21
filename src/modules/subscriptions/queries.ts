import "server-only";
import { and, asc, desc, eq, ne } from "drizzle-orm";
import { balancesOn, listAccounts } from "@/modules/accounts/queries";
import { listRecurringPatterns, payeeSamples, transactionsByIds } from "@/modules/transactions/queries";
import { colorOfCategory, listCategories } from "@/modules/transactions/taxonomy";
import type { Ctx } from "@/platform/context";
import { addDays, type CivilDate, civilDateIn, today } from "@/platform/dates";
import { getDb } from "@/platform/db/client";
import { userScoped } from "@/platform/db/scope";
import type { Cents } from "@/platform/money";
import {
  dueDates,
  LOW_UTILITY,
  monthlyEquivalent,
  nextCharge,
  type Suggestion,
  suggestionsFrom,
  yearlyEquivalent,
} from "./rules";
import { subscriptionCharges, subscriptions } from "./schema";
import type { Subscription, SubscriptionCharge } from "./service";

/** The window of "Next 30 days" and of the "Month" projection (design). */
const MONTH_DAYS = 30;
const YEAR_DAYS = 365;
/** A period that closed without a charge is an alert for this long after it closed. */
const ALERT_DAYS = 31;

export interface SubscriptionRow {
  subscription: Subscription;
  categoryName: string | null;
  /** The category's colour, or its group's for a sub-category (spec §7.2, F2.5). */
  categoryColor: string | null;
  groupId: string | null;
  groupName: string | null;
  accountName: string | null;
  monthlyCents: Cents;
  yearlyCents: Cents;
  nextChargeOn: CivilDate;
  /** The check of the period under way, or of a charge due within a week; `null` is "Not due". */
  current: SubscriptionCharge | null;
  /** The last charge found, with the day of the movement. */
  lastMatch: { on: CivilDate; cents: Cents } | null;
}

export interface Alert {
  subscriptionId: string;
  name: string;
  charge: SubscriptionCharge;
  accountName: string | null;
  payeeMatch: string | null;
}

export interface Projection {
  accountId: string | null;
  accountName: string | null;
  count: number;
  balanceCents: Cents | null;
  commitCents: Cents;
  projectedCents: Cents | null;
}

export interface SubscriptionsView {
  /** Active ones first by name; the paused and the cancelled follow in their own list. */
  rows: SubscriptionRow[];
  inactive: SubscriptionRow[];
  monthlyCents: Cents;
  yearlyCents: Cents;
  lowUtilityYearlyCents: Cents;
  lowUtilityCount: number;
  next30Cents: Cents;
  next30Until: CivilDate;
  alerts: Alert[];
  byCategory: { groupId: string | null; name: string | null; color: string | null; yearlyCents: Cents }[];
  projections: { month: Projection[]; year: Projection[] };
  accounts: { id: string; name: string }[];
}

/**
 * What an account will have once the active subscriptions it pays have been charged (spec §7.5):
 * its latest balance minus the charges due in `(today, today + days]` that have not been found
 * already. `null` while the account has no balance. The subscriptions with no paying account are
 * one group of their own, with no balance.
 */
function project(
  rows: readonly SubscriptionRow[],
  charges: readonly SubscriptionCharge[],
  balances: ReadonlyMap<string, Cents>,
  todayOn: CivilDate,
  days: number,
): Projection[] {
  const found = new Set(
    charges
      .filter((charge) => charge.state === "paid" || charge.state === "amount_differs")
      .map((charge) => `${charge.subscriptionId}|${charge.dueOn}`),
  );
  const groups = new Map<string | null, Projection>();
  for (const row of rows) {
    const id = row.subscription.paymentAccountId;
    const group = groups.get(id) ?? {
      accountId: id,
      accountName: row.accountName,
      count: 0,
      balanceCents: id === null ? null : (balances.get(id) ?? null),
      commitCents: 0n,
      projectedCents: null,
    };
    group.count += 1;
    for (const due of dueDates(
      row.subscription.nextChargeOn,
      row.subscription.cycle,
      addDays(todayOn, 1),
      addDays(todayOn, days),
    )) {
      if (!found.has(`${row.subscription.id}|${due}`)) group.commitCents += row.subscription.priceCents;
    }
    groups.set(id, group);
  }
  return [...groups.values()]
    .map((group) => ({
      ...group,
      projectedCents: group.balanceCents === null ? null : group.balanceCents - group.commitCents,
    }))
    .sort(
      (a, b) =>
        Number(a.accountId === null) - Number(b.accountId === null) ||
        (a.accountName ?? "").localeCompare(b.accountName ?? ""),
    );
}

/** Everything the Subscriptions page renders (spec §7.5), read once. */
export async function subscriptionsView(
  ctx: Pick<Ctx, "userId" | "timeZone">,
  now: Date = new Date(),
): Promise<SubscriptionsView> {
  const todayOn = today(ctx.timeZone, now);
  const [all, charges, categories, accounts] = await Promise.all([
    getDb()
      .select()
      .from(subscriptions)
      .where(userScoped(ctx).owns(subscriptions))
      .orderBy(asc(subscriptions.name), asc(subscriptions.id)),
    getDb()
      .select()
      .from(subscriptionCharges)
      .where(userScoped(ctx).owns(subscriptionCharges))
      .orderBy(asc(subscriptionCharges.subscriptionId), desc(subscriptionCharges.dueOn)),
    listCategories(ctx, { includeArchived: true }),
    listAccounts(ctx, { includeArchived: true }),
  ]);
  const category = new Map(categories.map((row) => [row.id, row]));
  const accountName = new Map(accounts.map((row) => [row.id, row.name]));
  const matched = await transactionsByIds(
    ctx,
    charges.flatMap((charge) => (charge.transactionId ? [charge.transactionId] : [])),
  );

  const rows: SubscriptionRow[] = all.map((subscription) => {
    const own = charges.filter((charge) => charge.subscriptionId === subscription.id);
    const cat = subscription.categoryId ? category.get(subscription.categoryId) : undefined;
    const parent = cat?.parentId ? category.get(cat.parentId) : undefined;
    const paid = new Set(
      own
        .filter((charge) => charge.state === "paid" || charge.state === "amount_differs")
        .map((charge) => charge.dueOn),
    );
    const current =
      own.find((charge) => charge.periodFrom <= todayOn && todayOn <= charge.periodTo) ??
      own.find((charge) => charge.state === "due") ??
      null;
    const last = own.find((charge) => charge.transactionId !== null && matched.has(charge.transactionId));
    const lastMovement = last ? matched.get(last.transactionId as string) : undefined;
    return {
      subscription,
      categoryName: cat?.name ?? null,
      categoryColor: cat ? colorOfCategory(cat, category) : null,
      groupId: (parent ?? cat)?.id ?? null,
      groupName: (parent ?? cat)?.name ?? null,
      accountName: subscription.paymentAccountId
        ? (accountName.get(subscription.paymentAccountId) ?? null)
        : null,
      monthlyCents: monthlyEquivalent(subscription.priceCents, subscription.cycle),
      yearlyCents: yearlyEquivalent(subscription.priceCents, subscription.cycle),
      nextChargeOn: nextCharge(subscription.nextChargeOn, subscription.cycle, todayOn, paid),
      current,
      lastMatch:
        last && lastMovement
          ? { on: civilDateIn(lastMovement.occurredAt, ctx.timeZone), cents: last.actualCents as Cents }
          : null,
    };
  });
  const active = rows.filter((row) => row.subscription.state === "active");
  const sum = (values: Cents[]) => values.reduce<Cents>((total, value) => total + value, 0n);

  const recentlyClosed = addDays(todayOn, -ALERT_DAYS);
  const alerts: Alert[] = active.flatMap((row) => {
    const own = charges.filter((charge) => charge.subscriptionId === row.subscription.id);
    const missing = own.find((charge) => charge.state === "not_found" && charge.periodTo >= recentlyClosed);
    const picked = [
      ...(missing ? [missing] : []),
      ...(row.current && (row.current.state === "due" || row.current.state === "amount_differs")
        ? [row.current]
        : []),
    ];
    return picked.map((charge) => ({
      subscriptionId: row.subscription.id,
      name: row.subscription.name,
      charge,
      accountName: row.accountName,
      payeeMatch: row.subscription.payeeMatch,
    }));
  });

  const byCategory = new Map<string | null, SubscriptionsView["byCategory"][number]>();
  for (const row of active) {
    const entry = byCategory.get(row.groupId) ?? {
      groupId: row.groupId,
      name: row.groupName,
      color: row.categoryColor,
      yearlyCents: 0n,
    };
    entry.yearlyCents += row.yearlyCents;
    byCategory.set(row.groupId, entry);
  }

  const next30Until = addDays(todayOn, MONTH_DAYS);
  const found = new Set(
    charges
      .filter((charge) => charge.state === "paid" || charge.state === "amount_differs")
      .map((charge) => `${charge.subscriptionId}|${charge.dueOn}`),
  );
  const next30Cents = sum(
    active.flatMap((row) =>
      dueDates(row.subscription.nextChargeOn, row.subscription.cycle, todayOn, next30Until)
        .filter((due) => !found.has(`${row.subscription.id}|${due}`))
        .map(() => row.subscription.priceCents),
    ),
  );

  const paying = [
    ...new Set(
      active.flatMap((row) => (row.subscription.paymentAccountId ? [row.subscription.paymentAccountId] : [])),
    ),
  ];
  const balances = await balancesOn(ctx, paying, todayOn);
  const low = active.filter((row) => row.subscription.utility <= LOW_UTILITY);

  return {
    rows: active,
    inactive: rows.filter((row) => row.subscription.state !== "active"),
    monthlyCents: sum(active.map((row) => row.monthlyCents)),
    yearlyCents: sum(active.map((row) => row.yearlyCents)),
    lowUtilityYearlyCents: sum(low.map((row) => row.yearlyCents)),
    lowUtilityCount: low.length,
    next30Cents,
    next30Until,
    alerts,
    byCategory: [...byCategory.values()].sort(
      (a, b) => Number(b.yearlyCents - a.yearlyCents) || (a.name ?? "").localeCompare(b.name ?? ""),
    ),
    projections: {
      month: project(active, charges, balances, todayOn, MONTH_DAYS),
      year: project(active, charges, balances, todayOn, YEAR_DAYS),
    },
    accounts: accounts
      .filter((account) => account.state !== "archived")
      .map((account) => ({ id: account.id, name: account.name })),
  };
}

/** "Suggest from recurring payments" (spec §7.5): the detected patterns no subscription covers. */
export async function suggestions(ctx: Pick<Ctx, "userId" | "timeZone">): Promise<Suggestion[]> {
  const [patterns, existing] = await Promise.all([
    listRecurringPatterns(ctx),
    getDb()
      .select({ payeeMatch: subscriptions.payeeMatch })
      .from(subscriptions)
      .where(userScoped(ctx).owns(subscriptions)),
  ]);
  const outgoing = patterns.filter((pattern) => pattern.sign < 0);
  const samples = await payeeSamples(
    ctx,
    outgoing.map((pattern) => pattern.payeeKey),
  );
  return suggestionsFrom(outgoing, samples, existing);
}

/** The active subscriptions an account pays, for Account detail (design: "Subscriptions" row). */
export async function subscriptionsOnAccount(
  ctx: Pick<Ctx, "userId">,
  accountId: string,
): Promise<{ count: number; monthlyCents: Cents }> {
  const rows = await getDb()
    .select({ priceCents: subscriptions.priceCents, cycle: subscriptions.cycle })
    .from(subscriptions)
    .where(
      and(
        userScoped(ctx).owns(subscriptions),
        eq(subscriptions.paymentAccountId, accountId),
        eq(subscriptions.state, "active"),
      ),
    );
  return {
    count: rows.length,
    monthlyCents: rows.reduce<Cents>((sum, row) => sum + monthlyEquivalent(row.priceCents, row.cycle), 0n),
  };
}

/** Subscriptions by name, for the ⌘K palette (spec §8.2). */
export async function searchSubscriptions(
  ctx: Pick<Ctx, "userId">,
  term: string,
): Promise<{ id: string; name: string }[]> {
  const needle = term.trim().toLocaleLowerCase();
  if (needle === "") return [];
  const rows = await getDb()
    .select({ id: subscriptions.id, name: subscriptions.name })
    .from(subscriptions)
    .where(and(userScoped(ctx).owns(subscriptions), ne(subscriptions.state, "cancelled")))
    .orderBy(asc(subscriptions.name), asc(subscriptions.id));
  return rows.filter((row) => row.name.toLocaleLowerCase().includes(needle)).slice(0, 5);
}
