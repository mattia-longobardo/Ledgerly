"use client";

// The tab «Entries» of an account's page: its recorded balances from `GET /accounts/{id}/balances`,
// each with the change the API answers, and the form that records one.
import { balances } from "@ledgerly/api-contract/accounts";
import type { RouteOutput } from "@ledgerly/api-client";
import { today } from "@ledgerly/format/dates";
import { formatAmountInput, formatDate, formatMoney, NULL_DISPLAY } from "@ledgerly/format/format";
import { useApi } from "@ledgerly/ui/data";
import { Loaded } from "@ledgerly/ui/loaded";
import { BalanceEntries, centsOf, type EntryRow } from "@/modules/accounts/client";
import type { AccountPage } from "./account-screen";

type Entry = RouteOutput<typeof balances.getAccountBalances>["balances"][number];

function entryRow(entry: Entry, page: AccountPage): EntryRow {
  const { numberFormat, locale } = page.format;
  const own = { currency: page.account.currency };
  const change = centsOf(entry.change.amount);
  return {
    id: entry.id,
    on: entry.on,
    onLabel: formatDate(entry.on, "long", locale),
    balance: formatMoney(centsOf(entry.balance), numberFormat, own),
    change: change === null ? NULL_DISPLAY : formatMoney(change, numberFormat, { signed: true, ...own }),
    changeSign: change === null ? 0 : Number(change),
    note: entry.note,
    source: entry.source,
    // What the correction form puts back in its fields, written the way the person types amounts.
    amountInput: formatAmountInput(centsOf(entry.balance), numberFormat),
    availableInput: formatAmountInput(centsOf(entry.available), numberFormat),
  };
}

export function EntriesTab({ page }: { page: AccountPage }) {
  const { account } = page;
  const read = useApi(balances.getAccountBalances, { params: { id: account.id } });
  return (
    <Loaded state={read}>
      {(answer) => (
        <BalanceEntries
          accountId={account.id}
          today={today(page.format.timeZone)}
          synced={account.origin === "synced"}
          // A service of Investments takes no manual balance (docs/design/investments.md §1.3).
          managedHref={page.context.managed ? `/investments/${account.id}` : null}
          entries={answer.balances.map((entry) => entryRow(entry, page))}
        />
      )}
    </Loaded>
  );
}
