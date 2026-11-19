"use client";

// The accounts of `GET /net-worth` as the Accounts screen lists them: a table, and a list below `md`.
import Link from "next/link";
import { useTranslations } from "next-intl";
import type { views } from "@ledgerly/api-contract/accounts";
import type { RouteOutput } from "@ledgerly/api-client";
import { formatDate, formatMoney, formatPercent, NULL_DISPLAY } from "@ledgerly/format/format";
import { Badge } from "@ledgerly/ui/badge";
import { Sparkline } from "@ledgerly/ui/chart";
import { asNumbers } from "@ledgerly/ui/chart-labels";
import { SyncStatus } from "@ledgerly/ui/sync-status";
import { Table, TBody, Td, Th, THead, TotalRow, Tr } from "@ledgerly/ui/table";
import { TONE_TEXT, toneOfSign } from "@ledgerly/ui/tone";
import { type CardFormat, centsOf, colorFor, counterValue } from "@/modules/accounts/client";

export type NetWorth = RouteOutput<typeof views.getNetWorth>;
type ViewRow = NetWorth["accounts"][number];

/** A row as the table and the list draw it: the API's, with its colour and its formatted figures. */
export interface Row extends ViewRow {
  color: string;
  counter: string | null;
  syncedAt: string | null;
}

export function rowsOf(view: NetWorth, format: CardFormat): Row[] {
  return view.accounts.map((row, index) => ({
    ...row,
    color: colorFor(row, index),
    counter: counterValue(
      { currency: row.currency, display: { balance: centsOf(row.display.balance) } },
      view.currency,
      format.numberFormat,
    ),
    // A service of Investments fed by a provider is synced, from its last reading (investments-ux §8).
    syncedAt: row.service?.lastSyncedAt ?? row.lastSyncedAt,
  }));
}

/** Every total on the page is in the display currency (§1.8, D1). */
export function displayMoney(
  amount: string | null,
  view: NetWorth,
  format: CardFormat,
  signed = false,
): string {
  return formatMoney(centsOf(amount), format.numberFormat, { signed, currency: view.currency });
}

/** An account's own figure, in its own currency; `signed` for a change. */
function own(row: Row, amount: string | null, format: CardFormat, signed = false): string {
  const cents = centsOf(amount);
  if (signed && cents === null) return NULL_DISPLAY;
  return formatMoney(cents, format.numberFormat, { signed, currency: row.currency });
}

function AccountName({ row }: { row: Row }) {
  return (
    <>
      <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ background: row.color }} />
      <Link
        href={`/accounts/${row.id}`}
        className="focus-ring inline-flex min-h-6 items-center rounded-xs font-medium hover:underline"
      >
        {row.name}
      </Link>
    </>
  );
}

function StateBadges({ row }: { row: Row }) {
  const text = useTranslations("accounts");
  return (
    <>
      {row.state === "unavailable" && <Badge tone="warn">{text("states.unavailable")}</Badge>}
      {row.state === "archived" && <Badge tone="neutral">{text("states.archived")}</Badge>}
      {row.stale && <Badge tone="warn">{text("stale")}</Badge>}
    </>
  );
}

function RowSync({ row }: { row: Row }) {
  return (
    <SyncStatus
      manual={row.origin === "manual" && row.service === null}
      lastSyncedAt={row.syncedAt}
      now={new Date().toISOString()}
    />
  );
}

export function AccountsTable({
  view,
  rows,
  format,
  end,
}: {
  view: NetWorth;
  rows: Row[];
  format: CardFormat;
  end: string;
}) {
  const text = useTranslations("accounts");
  const change = centsOf(view.change.amount);
  return (
    <Table>
      <THead>
        <Th>{text("columns.name")}</Th>
        <Th>{text("columns.type")}</Th>
        <Th align="right">
          {text("columns.balanceOn", { period: formatDate(end, "monthShort", format.locale) })}
        </Th>
        <Th align="right">{text("columns.monthlyChange")}</Th>
        <Th align="right">{text("columns.yoy")}</Th>
        <Th align="right">{text("columns.share")}</Th>
        <Th>{text("columns.lastSynced")}</Th>
        <Th>{text("columns.history")}</Th>
      </THead>
      <TBody>
        {rows.map((row) => (
          <TableRow key={row.id} row={row} format={format} />
        ))}
        <TotalRow label={text("total")}>
          <Td />
          <Td align="right">{displayMoney(view.total, view, format)}</Td>
          <Td align="right" className={TONE_TEXT[toneOfSign(change)]}>
            {change === null ? NULL_DISPLAY : displayMoney(view.change.amount, view, format, true)}
          </Td>
          <Td />
          {/* The total is the whole of itself: 100 %, the dash when it is unknown. */}
          <Td align="right">{formatPercent(view.total === null ? null : 1, format.numberFormat)}</Td>
          <Td />
          <Td />
        </TotalRow>
      </TBody>
    </Table>
  );
}

function TableRow({ row, format }: { row: Row; format: CardFormat }) {
  const text = useTranslations("accounts");
  return (
    <Tr>
      <Td>
        <div className="flex items-center gap-2">
          <AccountName row={row} />
          <StateBadges row={row} />
        </div>
      </Td>
      <Td muted>{text(`types.${row.type}`)}</Td>
      <Td align="right">
        {own(row, row.balance, format)}
        {row.counter && <span className="block text-sm text-muted">{row.counter}</span>}
      </Td>
      <Td align="right" className={TONE_TEXT[toneOfSign(centsOf(row.change.amount))]}>
        {own(row, row.change.amount, format, true)}
      </Td>
      <Td align="right" className={TONE_TEXT[toneOfSign(centsOf(row.yoy.amount))]}>
        {formatPercent(row.yoy.fraction, format.numberFormat, { signed: true })}
      </Td>
      <Td align="right">{formatPercent(row.share, format.numberFormat)}</Td>
      <Td muted>
        <RowSync row={row} />
      </Td>
      <Td>
        <Sparkline values={asNumbers(row.series.map(centsOf))} tone={row.color} />
      </Td>
    </Tr>
  );
}

/** The same accounts as a list, below `md`. */
export function PhoneList({ view, rows, format }: { view: NetWorth; rows: Row[]; format: CardFormat }) {
  const text = useTranslations("accounts");
  return (
    <ul className="flex flex-col md:hidden">
      {rows.map((row) => (
        <li key={row.id} className="flex flex-col gap-2 border-b border-border px-4 py-3 last:border-0">
          <div className="flex items-start justify-between gap-2">
            <span className="flex min-w-0 items-center gap-2">
              <AccountName row={row} />
            </span>
            <span className="flex shrink-0 flex-col items-end font-medium tabular-nums">
              {own(row, row.balance, format)}
              {row.counter && <span className="text-sm font-normal text-muted">{row.counter}</span>}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">
            <span>{text(`types.${row.type}`)}</span>
            <span aria-hidden>·</span>
            <span>
              <RowSync row={row} />
            </span>
            <StateBadges row={row} />
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm tabular-nums">
            <span className={TONE_TEXT[toneOfSign(centsOf(row.change.amount))]}>
              {text("columns.monthlyChange")} {own(row, row.change.amount, format, true)}
            </span>
            <span className={TONE_TEXT[toneOfSign(centsOf(row.yoy.amount))]}>
              {text("columns.yoy")} {formatPercent(row.yoy.fraction, format.numberFormat, { signed: true })}
            </span>
            <span className="text-muted">
              {text("columns.share")} {formatPercent(row.share, format.numberFormat)}
            </span>
          </div>
          <Sparkline values={asNumbers(row.series.map(centsOf))} tone={row.color} />
        </li>
      ))}
      <li className="flex items-center justify-between gap-2 px-4 py-3 font-medium">
        <span>{text("total")}</span>
        <span className="tabular-nums">{displayMoney(view.total, view, format)}</span>
      </li>
    </ul>
  );
}
