// Accounts · the one serializer of each resource (audit ACC-5, API-2): the REST route and its MCP
// tool answer through these, so the two cannot write a field two ways. Money leaves as a decimal
// string, a moment as ISO 8601, and an IBAN never (H45).
import type { z } from "zod";
import type { ACCOUNTS } from "@ledgerly/api-contract";
import { type Account, bucketOf, type Change } from "@ledgerly/domain/accounts";
import type { AccountSource } from "@ledgerly/domain/platform/plugins";
import { type Cents, centsToDecimal } from "@ledgerly/domain/shared/money";

type Wire<T extends z.ZodType> = z.input<T>;
type Detail = Wire<typeof ACCOUNTS.accounts.getAccount.response>;
type Row = Wire<typeof ACCOUNTS.accounts.listAccounts.response>["accounts"][number];
type Entry = Wire<typeof ACCOUNTS.balances.updateBalanceEntry.response>;
type Snapshot = Wire<typeof ACCOUNTS.summary.listSnapshots.response>["snapshots"][number];
type ViewRow = Wire<typeof ACCOUNTS.views.getNetWorth.response>["accounts"][number];

export const money = (cents: Cents | null): string | null => (cents === null ? null : centsToDecimal(cents));
export const moneyOf = (cents: Cents): string => centsToDecimal(cents);
export const instant = (moment: Date | null): string | null => moment?.toISOString() ?? null;
/** A change of the domain (`changeBetween`) as the wire writes it. */
export const delta = (change: Change) => ({ amount: money(change.cents), fraction: change.fraction });

/** Where an account stands with its source (H56), as the wire writes it. */
const sourceOf = (source: AccountSource) => ({ ...source, stoppedSince: instant(source.stoppedSince) });

export function accountRow(account: Account, balance: Cents | null, source: AccountSource): Row {
  return {
    id: account.id,
    name: account.name,
    type: account.type,
    currency: account.currency,
    origin: account.origin,
    state: account.state,
    inNetWorth: account.inNetWorth,
    countsAsLiquid: account.countsAsLiquid,
    balance: money(balance),
    lastSyncedAt: instant(account.lastSyncedAt),
    ...sourceOf(source),
  };
}

/** One account with its settings, and the pension fund whose value it holds (null for any other). */
export function accountDetail(account: Account, fundId: string | null, source: AccountSource): Detail {
  return {
    id: account.id,
    name: account.name,
    type: account.type,
    currency: account.currency,
    origin: account.origin,
    provider: account.provider,
    state: account.state,
    color: account.color,
    reference: account.reference,
    hasIban: account.iban !== null,
    ibanFromSource: account.ibanFromSource,
    purpose: account.purpose,
    openedOn: account.openedOn,
    notes: account.notes,
    inNetWorth: account.inNetWorth,
    inSnapshot: account.inSnapshot,
    countsAsLiquid: account.countsAsLiquid,
    lowBalance: money(account.lowBalanceCents),
    staleAfterHours: account.staleAfterHours,
    reminder: account.reminder,
    betweenEntries: account.betweenEntries,
    lastSyncedAt: instant(account.lastSyncedAt),
    archivedAt: instant(account.archivedAt),
    fundId,
    ...sourceOf(source),
  };
}

export function balanceEntry(entry: {
  id: string;
  on: string;
  balanceCents: Cents;
  availableCents: Cents | null;
  source: Entry["source"];
  note: string | null;
  capturedAt: Date;
}): Entry {
  return {
    id: entry.id,
    on: entry.on,
    balance: moneyOf(entry.balanceCents),
    available: money(entry.availableCents),
    source: entry.source,
    note: entry.note,
    capturedAt: entry.capturedAt.toISOString(),
  };
}

export function snapshot(run: {
  month: string;
  state: Snapshot["state"];
  accountsWritten: number;
  accountsSkipped: number;
  totalCents: Cents | null;
  totalCurrency: string;
  warnings: string[] | null;
  ranAt: Date;
}): Snapshot {
  return {
    month: run.month,
    state: run.state,
    accountsWritten: run.accountsWritten,
    accountsSkipped: run.accountsSkipped,
    total: money(run.totalCents),
    totalCurrency: run.totalCurrency,
    warnings: run.warnings ?? [],
    ranAt: run.ranAt.toISOString(),
  };
}

export function viewRow(
  row: {
    account: Account;
    balance: Cents | null;
    previous: Cents | null;
    series: (Cents | null)[];
    estimated: boolean[];
    held: (Cents | null)[];
    display: { balance: Cents | null; previous: Cents | null; held: (Cents | null)[] };
    missingRate: boolean;
    stale: boolean;
  },
  extra: Pick<ViewRow, "change" | "seriesChange" | "yoy" | "share" | "service" | "investmentGroup">,
): ViewRow {
  const { account } = row;
  return {
    id: account.id,
    name: account.name,
    type: account.type,
    currency: account.currency,
    origin: account.origin,
    state: account.state,
    color: account.color,
    inNetWorth: account.inNetWorth,
    countsAsLiquid: account.countsAsLiquid,
    bucket: bucketOf(account),
    balance: money(row.balance),
    previous: money(row.previous),
    series: row.series.map(money),
    estimated: row.estimated,
    held: row.held.map(money),
    display: {
      balance: money(row.display.balance),
      previous: money(row.display.previous),
      held: row.display.held.map(money),
    },
    missingRate: row.missingRate,
    stale: row.stale,
    lastSyncedAt: instant(account.lastSyncedAt),
    ...extra,
  };
}
