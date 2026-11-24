import { and, asc, desc, eq, ne } from "drizzle-orm";
import { linkedPayees } from "./ports";
import { accountNames, accountOptions, readingsAt, listAccounts } from "../accounts";
import { payeeSamples, recurrences, transactionsByIds } from "../transactions/queries";
import { colorOfCategory, listCategories } from "../transactions/taxonomy";
import type { Ctx } from "../../platform/context";
import { addDays, type CivilDate, civilDateIn, today } from "../../shared/dates";
import { getDb } from "../../platform/db/client";
import { convertCents, ratesOn } from "../../platform/fx";
import { userScoped } from "../../platform/db/scope";
import type { Cents } from "../../shared/money";
import { groupBy, searchByName } from "../../shared/collections";
import {
  frequencyOf,
  commitPercent,
  foundCharges,
  PRICE_CURRENCY,
  LOW_UTILITY,
  monthlyCost,
  monthlyEquivalent,
  nextCharge,
  type Suggestion,
  suggestionsFrom,
  upcomingCharges,
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

interface Alert {
  subscriptionId: string;
  name: string;
  charge: SubscriptionCharge;
  accountName: string | null;
  payeeMatch: string | null;
}

interface Projection {
  accountId: string | null;
  accountName: string | null;
  count: number;
  balanceCents: Cents | null;
  commitCents: Cents;
  projectedCents: Cents | null;
  /** The part of the balance `commitCents` takes, one decimal (`commitPercent`). */
  percent: number | null;
}

interface SubscriptionsView {
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

/** A row as `upcomingCharges` reads it. */
const planOf = (row: SubscriptionRow) => ({
  id: row.subscription.id,
  priceCents: row.subscription.priceCents,
  cycle: frequencyOf(row.subscription),
  anchor: row.subscription.nextChargeOn,
  row,
});

const sum = (values: Cents[]) => values.reduce<Cents>((total, value) => total + value, 0n);

/** What the projections read besides the rows: the charges found and the paying accounts' balances. */
interface Commitments {
  found: ReadonlyMap<string, ReadonlySet<CivilDate>>;
  balances: ReadonlyMap<string, Cents>;
}

/**
 * What an account will have once the active subscriptions it pays have been charged (spec §7.5):
 * its latest balance minus the charges due in `[from, to]` that have not been found already. `null`
 * while the account has no balance. The subscriptions with no paying account are one group of their
 * own, with no balance.
 */
function project(
  rows: readonly SubscriptionRow[],
  { found, balances }: Commitments,
  window: { from: CivilDate; to: CivilDate },
): Projection[] {
  const commits = groupBy(
    upcomingCharges(rows.map(planOf), found, window.from, window.to),
    ({ plan }) => plan.row.subscription.paymentAccountId,
    ({ plan }) => plan.priceCents,
  );
  return [...groupBy(rows, (row) => row.subscription.paymentAccountId).entries()]
    .map(([id, group]) => {
      const balanceCents = id === null ? null : (balances.get(id) ?? null);
      const commitCents = sum(commits.get(id) ?? []);
      return {
        accountId: id,
        accountName: group[0].accountName,
        count: group.length,
        balanceCents,
        commitCents,
        projectedCents: balanceCents === null ? null : balanceCents - commitCents,
        percent: commitPercent(commitCents, balanceCents),
      };
    })
    .sort(
      (left, right) =>
        Number(left.accountId === null) - Number(right.accountId === null) ||
        (left.accountName ?? "").localeCompare(right.accountName ?? ""),
    );
}

type Charge = SubscriptionCharge;
type CategoryRow = Awaited<ReturnType<typeof listCategories>>[number];

/** The category of a row, its colour and the group it counts under. */
function categoryOf(
  categoryId: string | null,
  category: ReadonlyMap<string, CategoryRow>,
): Pick<SubscriptionRow, "categoryName" | "categoryColor" | "groupId" | "groupName"> {
  const cat = categoryId ? category.get(categoryId) : undefined;
  if (!cat) return { categoryName: null, categoryColor: null, groupId: null, groupName: null };
  const group = (cat.parentId ? category.get(cat.parentId) : undefined) ?? cat;
  return {
    categoryName: cat.name,
    categoryColor: colorOfCategory(cat, category),
    groupId: group.id,
    groupName: group.name,
  };
}

/** The last charge found, on the day of its movement. */
function lastMatchOf(
  own: readonly Charge[],
  matched: Awaited<ReturnType<typeof transactionsByIds>>,
  timeZone: string,
): SubscriptionRow["lastMatch"] {
  for (const charge of own) {
    const movement = charge.transactionId === null ? undefined : matched.get(charge.transactionId);
    if (!movement) continue;
    // A movement is held by a paid or differing charge only, which always has its amount.
    return charge.actualCents === null
      ? null
      : { on: civilDateIn(movement.occurredAt, timeZone), cents: charge.actualCents };
  }
  return null;
}

/** What the rows are made from: the reads of the page, the charges by subscription, the found set. */
interface Sources {
  todayOn: CivilDate;
  timeZone: string;
  category: ReadonlyMap<string, CategoryRow>;
  accountName: ReadonlyMap<string, string>;
  bySubscription: ReadonlyMap<string, Charge[]>;
  found: ReadonlyMap<string, ReadonlySet<CivilDate>>;
  matched: Awaited<ReturnType<typeof transactionsByIds>>;
}

function rowOf(subscription: Subscription, sources: Sources): SubscriptionRow {
  const { todayOn } = sources;
  const own = sources.bySubscription.get(subscription.id) ?? [];
  const current =
    own.find((charge) => charge.periodFrom <= todayOn && todayOn <= charge.periodTo) ??
    own.find((charge) => charge.state === "due") ??
    null;
  const paid = sources.found.get(subscription.id) ?? new Set<CivilDate>();
  return {
    subscription,
    ...categoryOf(subscription.categoryId, sources.category),
    accountName: subscription.paymentAccountId
      ? (sources.accountName.get(subscription.paymentAccountId) ?? null)
      : null,
    monthlyCents: monthlyEquivalent(subscription.priceCents, frequencyOf(subscription)),
    yearlyCents: yearlyEquivalent(subscription.priceCents, frequencyOf(subscription)),
    nextChargeOn: nextCharge(subscription.nextChargeOn, frequencyOf(subscription), todayOn, paid),
    current,
    lastMatch: lastMatchOf(own, sources.matched, sources.timeZone),
  };
}

/** A missing charge of a period closed in the last month, and the one under way when it needs a look. */
function alertsOf(active: readonly SubscriptionRow[], sources: Sources): Alert[] {
  const recentlyClosed = addDays(sources.todayOn, -ALERT_DAYS);
  return active.flatMap((row) => {
    const own = sources.bySubscription.get(row.subscription.id) ?? [];
    const missing = own.find((charge) => charge.state === "not_found" && charge.periodTo >= recentlyClosed);
    const state = row.current?.state;
    const picked = [
      ...(missing ? [missing] : []),
      ...(row.current && (state === "due" || state === "amount_differs") ? [row.current] : []),
    ];
    return picked.map((charge) => ({
      subscriptionId: row.subscription.id,
      name: row.subscription.name,
      charge,
      accountName: row.accountName,
      payeeMatch: row.subscription.payeeMatch,
    }));
  });
}

/** The yearly cost of the active ones by category group, largest first. */
function byCategoryOf(active: readonly SubscriptionRow[]): SubscriptionsView["byCategory"] {
  return [...groupBy(active, (row) => row.groupId).values()]
    .map((group) => ({
      groupId: group[0].groupId,
      name: group[0].groupName,
      color: group[0].categoryColor,
      yearlyCents: sum(group.map((row) => row.yearlyCents)),
    }))
    .sort(
      (left, right) =>
        Number(right.yearlyCents - left.yearlyCents) || (left.name ?? "").localeCompare(right.name ?? ""),
    );
}

/** The reads of the page, at once, and the movements of the charges found. */
async function sourcesOf(ctx: Pick<Ctx, "userId" | "timeZone">, todayOn: CivilDate) {
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
  const matched = await transactionsByIds(
    ctx,
    charges.flatMap((charge) => (charge.transactionId ? [charge.transactionId] : [])),
  );
  const sources: Sources = {
    todayOn,
    timeZone: ctx.timeZone,
    category: new Map(categories.map((row) => [row.id, row])),
    accountName: accountNames(accounts),
    bySubscription: groupBy(charges, (charge) => charge.subscriptionId),
    found: foundCharges(charges),
    matched,
  };
  return { all, accounts, sources };
}

/**
 * The latest balance of each paying account in the currency of the prices (D4): one in another
 * currency is converted at the ECB rate of the day (`convertCents`, the accounts' rule); one with no
 * rate is left out, so its projection is unknown rather than a sum of two currencies. With every
 * account in the prices' currency no rate is read.
 */
async function balancesInPriceCurrency(
  ctx: Pick<Ctx, "userId">,
  accounts: readonly { id: string; currency: string }[],
  paying: readonly string[],
  day: CivilDate,
): Promise<Map<string, Cents>> {
  const currency = new Map(accounts.map((account) => [account.id, account.currency]));
  const [native, rates] = await Promise.all([
    readingsAt(ctx, paying, day),
    ratesOn([PRICE_CURRENCY, ...paying.map((id) => currency.get(id) ?? PRICE_CURRENCY)], day, day),
  ]);
  return new Map(
    [...native].flatMap(([id, cents]) => {
      const converted = convertCents(cents, currency.get(id) ?? PRICE_CURRENCY, PRICE_CURRENCY, day, rates);
      return converted === null ? [] : [[id, converted] as const];
    }),
  );
}

/** Everything the Subscriptions page renders (spec §7.5), read once. */
export async function subscriptionsView(
  ctx: Pick<Ctx, "userId" | "timeZone">,
  now: Date = new Date(),
): Promise<SubscriptionsView> {
  const todayOn = today(ctx.timeZone, now);
  const { all, accounts, sources } = await sourcesOf(ctx, todayOn);
  const rows = all.map((subscription) => rowOf(subscription, sources));
  const active = rows.filter((row) => row.subscription.state === "active");
  const next30Until = addDays(todayOn, MONTH_DAYS);
  const paying = [...new Set(active.flatMap((row) => row.subscription.paymentAccountId ?? []))];
  const balances = await balancesInPriceCurrency(ctx, accounts, paying, todayOn);
  const commitments = { found: sources.found, balances };
  const low = active.filter(
    (row) => row.subscription.utility !== null && row.subscription.utility <= LOW_UTILITY,
  );
  return {
    rows: active,
    inactive: rows.filter((row) => row.subscription.state !== "active"),
    monthlyCents: monthlyCost(active.map((row) => row.subscription)),
    yearlyCents: sum(active.map((row) => row.yearlyCents)),
    lowUtilityYearlyCents: sum(low.map((row) => row.yearlyCents)),
    lowUtilityCount: low.length,
    next30Cents: sum(
      upcomingCharges(active.map(planOf), sources.found, todayOn, next30Until).map(
        ({ plan }) => plan.priceCents,
      ),
    ),
    next30Until,
    alerts: alertsOf(active, sources),
    byCategory: byCategoryOf(active),
    projections: {
      // From today, as «Next 30 days» (D6): a charge due today is still to come until it is found.
      month: project(active, commitments, { from: todayOn, to: next30Until }),
      year: project(active, commitments, { from: todayOn, to: addDays(todayOn, YEAR_DAYS) }),
    },
    accounts: accountOptions(accounts),
  };
}

/** "Suggest from recurring payments" (spec §7.5): the detected patterns no subscription covers. */
export async function suggestions(ctx: Pick<Ctx, "userId" | "timeZone">): Promise<Suggestion[]> {
  const [patterns, existing, linked] = await Promise.all([
    recurrences(ctx),
    getDb()
      .select({ payeeMatch: subscriptions.payeeMatch })
      .from(subscriptions)
      .where(userScoped(ctx).owns(subscriptions)),
    linkedPayees().payeeKeys(ctx),
  ]);
  // A pattern with no cadence can be no subscription: its payee is not even looked up. Nor is the payee
  // of a movement tied to an investment, as a purchase plan's debit (R5d, §11.3.3).
  const outgoing = patterns.filter(
    (pattern) => pattern.sign < 0 && pattern.cadence !== null && !linked.has(pattern.payeeKey),
  );
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
    .select({
      priceCents: subscriptions.priceCents,
      cycle: subscriptions.cycle,
      everyUnit: subscriptions.everyUnit,
      everyCount: subscriptions.everyCount,
    })
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
    monthlyCents: monthlyCost(rows.map((row) => ({ priceCents: row.priceCents, cycle: frequencyOf(row) }))),
  };
}

/** Subscriptions by name, for the ⌘K palette (spec §8.2). */
export async function searchSubscriptions(
  ctx: Pick<Ctx, "userId">,
  term: string,
): Promise<{ id: string; name: string }[]> {
  return searchByName(term, () =>
    getDb()
      .select({ id: subscriptions.id, name: subscriptions.name })
      .from(subscriptions)
      .where(and(userScoped(ctx).owns(subscriptions), ne(subscriptions.state, "cancelled")))
      .orderBy(asc(subscriptions.name), asc(subscriptions.id)),
  );
}
