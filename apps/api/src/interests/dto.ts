// Interests · the one serializer of a rule (audit API-2): `GET /interests`, `GET /interests/{id}` and
// their MCP tools answer through these, so a field is written one way. Money leaves as a decimal
// string, a rate as a plain percentage.
import type { z } from "zod";
import type { INTERESTS } from "@ledgerly/api-contract";
import { fractionToPercent, interestsView, ruleAccounts, ruleDetail } from "@ledgerly/domain/interests";
import { type Cents, centsToDecimal } from "@ledgerly/domain/shared/money";

type List = z.input<typeof INTERESTS.interests.listInterestRules.response>;
type Detail = z.input<typeof INTERESTS.interests.getInterestRule.response>;
type Row = List["rules"][number];
type ViewRow = Awaited<ReturnType<typeof interestsView>>[number];
type DetailView = Awaited<ReturnType<typeof ruleDetail>>;

const money = centsToDecimal;
const maybe = (cents: Cents | null): string | null => (cents === null ? null : money(cents));

/** The row of the list, of the export and of both tools; the rule's page reads the same. */
function ruleRow(row: ViewRow): Row {
  const { rule } = row;
  return {
    id: rule.id,
    accountId: rule.accountId,
    account: row.accountName,
    validFrom: rule.validFrom,
    validTo: rule.validTo,
    runHour: rule.runHour,
    tiers: row.tiers.map((tier) => ({
      upTo: maybe(tier.upToCents),
      rate: fractionToPercent(tier.annualRate),
    })),
    tax: fractionToPercent(rule.taxRate),
    dayCount: rule.dayCount,
    periodAnchor: rule.periodAnchor,
    paymentWindowDays: rule.paymentWindowDays,
    settlement: rule.settlement,
    payeeMatch: rule.payeeMatch,
    mode: rule.mode,
    categoryId: rule.postingCategoryId,
    state: rule.state,
    accruedYtd: money(row.accruedYtdCents),
    grossYtd: money(row.grossYtdCents),
    nextPayout: row.nextPayout,
  };
}

/** `GET /interests`: the Interests page, read once. */
export function interestsList(
  view: Awaited<ReturnType<typeof interestsView>>,
  accounts: Awaited<ReturnType<typeof ruleAccounts>>,
  year: string,
): List {
  return {
    rules: view.map(ruleRow),
    totals: {
      year,
      accruedYtd: money(view.reduce((sum, row) => sum + row.accruedYtdCents, 0n)),
      grossYtd: money(view.reduce((sum, row) => sum + row.grossYtdCents, 0n)),
    },
    accounts,
  };
}

/** `GET /interests/{id}`: one rule's page; its row is the list's. */
export function interestRule(detail: DetailView): Detail {
  return {
    rule: ruleRow(detail),
    category: detail.categoryName,
    pending: money(detail.pendingCents),
    accruedYtd: money(detail.accruedYtdCents),
    balance: {
      synced: detail.balance.synced,
      lastSyncedAt: detail.balance.lastSyncedAt?.toISOString() ?? null,
      staleForAccrual: detail.balance.stale,
    },
    settlements: detail.settlements.map((row) => ({
      id: row.entry.id,
      periodFrom: row.entry.periodFrom,
      periodTo: row.entry.periodTo,
      settleOn: row.entry.settleOn,
      accruedDays: row.accruedDays,
      skippedDays: row.skippedDays,
      gross: money(row.entry.grossCents),
      tax: money(row.entry.taxCents),
      net: money(row.entry.netCents),
      paid: maybe(row.paidCents),
      status: row.status,
      posting: row.entry.posting,
      postingError: row.entry.postingError,
    })),
    days: detail.days.map((day) => ({
      id: day.id,
      on: day.on,
      balance: maybe(day.balanceCents),
      net: money(day.netCents),
      status: day.status,
    })),
  };
}
