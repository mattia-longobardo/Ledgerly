// Subscriptions · the one serializer of a subscription (audit API-2): `GET /subscriptions` and its MCP
// tool `list_subscriptions` answer through these, so a field is written one way. Money leaves as a
// decimal string, the tolerance as a percentage with two decimals.
import type { z } from "zod";
import type { SUBSCRIPTIONS } from "@ledgerly/api-contract";
import {
  cycleOf,
  everyOf,
  type Frequency,
  frequencyOf,
  type SubscriptionRow,
  subscriptionsView,
  toleranceParts,
} from "@ledgerly/domain/subscriptions";
import { type Cents, centsToDecimal } from "@ledgerly/domain/shared/money";

type List = z.input<typeof SUBSCRIPTIONS.subscriptions.listSubscriptions.response>;
type Row = List["subscriptions"][number];
type View = Awaited<ReturnType<typeof subscriptionsView>>;
type Check = NonNullable<SubscriptionRow["current"]>;

const money = centsToDecimal;
const maybe = (cents: Cents | null): string | null => (cents === null ? null : money(cents));

function chargeCheck(charge: Check): NonNullable<Row["current"]> {
  return {
    id: charge.id,
    dueOn: charge.dueOn,
    state: charge.state,
    expected: money(charge.expectedCents),
    actual: maybe(charge.actualCents),
  };
}

/** A frequency on the wire: one of the 4 cycles, or `custom` with its «every» (R5a). */
function wireFrequency(frequency: Frequency) {
  const cycle = cycleOf(frequency);
  return cycle !== null ? { cycle } : { cycle: "custom" as const, every: everyOf(frequency) };
}

/** The row of the page, of the export and of `list_subscriptions`. */
function subscriptionRow(row: SubscriptionRow): Row {
  const { subscription } = row;
  return {
    id: subscription.id,
    name: subscription.name,
    state: subscription.state,
    categoryId: subscription.categoryId,
    category: row.categoryName,
    categoryColor: row.categoryColor,
    accountId: subscription.paymentAccountId,
    account: row.accountName,
    price: money(subscription.priceCents),
    ...wireFrequency(frequencyOf(subscription)),
    chargeOn: subscription.nextChargeOn,
    nextChargeOn: row.nextChargeOn,
    utility: subscription.utility ?? 5,
    ...(subscription.utility === null ? { noVote: true as const } : {}),
    payeeMatch: subscription.payeeMatch,
    // Millionths of one as hundredths of a percent: "0.05" is "5.00".
    tolerance: money(toleranceParts(subscription.tolerance) / 100n),
    monthly: money(row.monthlyCents),
    yearly: money(row.yearlyCents),
    current: row.current ? chargeCheck(row.current) : null,
    lastMatch: row.lastMatch ? { on: row.lastMatch.on, amount: money(row.lastMatch.cents) } : null,
  };
}

function projection(one: View["projections"]["month"][number]): List["projections"]["month"][number] {
  return {
    accountId: one.accountId,
    account: one.accountName,
    count: one.count,
    balance: maybe(one.balanceCents),
    commit: money(one.commitCents),
    projected: maybe(one.projectedCents),
    percent: one.percent,
  };
}

/** `GET /subscriptions`: the Subscriptions page, read once. */
export function subscriptionsList(view: View): List {
  return {
    subscriptions: view.rows.map(subscriptionRow),
    inactive: view.inactive.map(subscriptionRow),
    totals: {
      monthly: money(view.monthlyCents),
      yearly: money(view.yearlyCents),
      lowUtility: { yearly: money(view.lowUtilityYearlyCents), count: view.lowUtilityCount },
      next30: { amount: money(view.next30Cents), until: view.next30Until },
    },
    alerts: view.alerts.map((alert) => ({
      subscriptionId: alert.subscriptionId,
      name: alert.name,
      charge: chargeCheck(alert.charge),
      account: alert.accountName,
      payeeMatch: alert.payeeMatch,
    })),
    byCategory: view.byCategory.map((entry) => ({
      groupId: entry.groupId,
      name: entry.name,
      color: entry.color,
      yearly: money(entry.yearlyCents),
    })),
    projections: {
      month: view.projections.month.map(projection),
      year: view.projections.year.map(projection),
    },
    accounts: view.accounts,
  };
}
