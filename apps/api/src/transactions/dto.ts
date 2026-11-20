// Transactions · the one serializer of each resource (audit TRX-5, API-2): the REST route, its MCP
// tool and the page answer through these, so a field is written one way. Money leaves as a decimal
// string, a moment as ISO 8601.
import type { z } from "zod";
import type { TRANSACTIONS } from "@ledgerly/api-contract";
import { incomeLessExpense, type SpendingGroup, type TransactionRow } from "@ledgerly/domain/transactions";
import { type Cents, centsToDecimal } from "@ledgerly/domain/shared/money";

type Wire<T extends z.ZodType> = z.input<T>;
type Row = Wire<typeof TRANSACTIONS.movements.listTransactions.response>["transactions"][number];
type Line = Wire<typeof TRANSACTIONS.movements.getTransaction.response>;
type Query = z.output<NonNullable<typeof TRANSACTIONS.movements.getTransactionsView.query>>;

export const money = (cents: Cents): string => centsToDecimal(cents);

/** The filters of the contract (TRX-10) as the domain reads them. */
export function filtersOf(query: Partial<Query>) {
  const accounts = [...(query.account ? [query.account] : []), ...(query.accounts ?? [])];
  const categories = [
    ...(query.category ? [query.category] : []),
    ...(query.categories ?? []).map((one) => (one === "none" ? null : one)),
  ];
  const types = [...(query.type ? [query.type] : []), ...(query.types ?? [])];
  return {
    from: query.from,
    to: query.to,
    accountIds: accounts.length > 0 ? accounts : undefined,
    categoryIds: categories.length > 0 ? categories : undefined,
    labelIds: query.labels,
    types: types.length > 0 ? types : undefined,
    payee: query.payee,
    includeHidden: query.hidden === "true",
    sort: query.sort,
    direction: query.direction,
    limit: query.limit,
    offset: query.offset,
  };
}

/** A movement as F8 lists it. */
export function transactionRow(row: TransactionRow): Row {
  return {
    id: row.id,
    on: row.on,
    occurredAt: row.occurredAt.toISOString(),
    accountId: row.accountId,
    accountName: row.accountName,
    amount: money(row.amountCents),
    currency: row.currency,
    type: row.type,
    state: row.state,
    categoryId: row.categoryId,
    categoryName: row.categoryName,
    payee: row.payee,
    note: row.note,
    labels: row.labels.map((label) => label.name),
    hidden: row.hidden,
  };
}

/** What the pages read of a movement besides the row: what the web knows of its source. */
interface LineExtras {
  editableAtSource: ReadonlySet<string>;
  sendSources: ReadonlyMap<string, string>;
}

/** A movement as the pages draw it: the same row, grown (one mapper, TRX-5). */
export function transactionLine(row: TransactionRow, extras: LineExtras): Line {
  return {
    ...transactionRow(row),
    categoryColor: row.categoryColor,
    categoryState: row.categoryState,
    categoryReason: row.categoryReason,
    categoryIsOwn: row.categoryIsOwn,
    suggestedCategoryId: row.suggestedCategoryId,
    labelIds: row.labels.map((label) => label.id),
    transferGroupId: row.transferGroupId,
    origin: row.origin,
    sendState: row.sendState,
    sendSource: row.sendState === null ? null : (extras.sendSources.get(row.accountId) ?? null),
    editableAtSource: extras.editableAtSource.has(row.id),
    removedUpstream: row.removedUpstreamAt !== null,
    edited: row.edited,
  };
}

/** `excludedCount` only where a total left movements out (D4), as the contract says. */
export function excludedOf(excludedCount: number | undefined) {
  return excludedCount === undefined ? {} : { excludedCount };
}

/** The money of a range: income and spending without the giroconti, `net` every movement (D3). */
export function summaryOf(summary: {
  count: number;
  incomeCents: Cents;
  expenseCents: Cents;
  netCents: Cents;
  excludedCount?: number;
}) {
  return {
    count: summary.count,
    income: money(summary.incomeCents),
    expense: money(summary.expenseCents),
    net: money(summary.netCents),
    incomeLessExpense: money(incomeLessExpense(summary)),
    ...excludedOf(summary.excludedCount),
  };
}

/** One group of `spending`, with the amounts as the wire writes them. */
export function spendingGroup(group: SpendingGroup) {
  const { totalCents, inCents, outCents, ...rest } = group;
  return {
    ...rest,
    amount: money(totalCents),
    in: inCents === null ? null : money(inCents),
    out: outCents === null ? null : money(outCents),
  };
}
