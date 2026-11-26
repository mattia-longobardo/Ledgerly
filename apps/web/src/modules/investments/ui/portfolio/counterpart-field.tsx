"use client";

// «From account» / «To account» of a deposit or a withdrawal (PERS-651): the other side of the leg the
// server writes in the account. Empty, the server's rule pairs it; else a bank movement of the days
// around it, one of the person's accounts, an account outside, or none (an income or a spending).
import { useTranslations } from "next-intl";
import { accounts as accountRoutes } from "@ledgerly/api-contract/accounts";
import { movements } from "@ledgerly/api-contract/transactions";
import { parseCents } from "@ledgerly/format/cents";
import { addDays } from "@ledgerly/format/dates";
import { formatDate, formatMoney } from "@ledgerly/format/format";
import { useApi } from "@ledgerly/ui/data";
import { Field } from "@ledgerly/ui/field";
import { Select } from "@ledgerly/ui/input";
import { AUTOMATIC } from "../../calls";
import type { ServiceContext } from "../dialog-kit";

/** The days around the operation the bank movements are offered from: the server's window. */
const WINDOW = 3;

/** The bank movements of the days around `day` that can be its other side: out for a deposit, in for a withdrawal. */
function useBankMovements(context: ServiceContext, day: string, deposit: boolean) {
  const read = useApi(movements.getTransactionsView, {
    query: { from: addDays(day, -WINDOW), to: addDays(day, WINDOW), limit: 100 },
  });
  return (read.data?.rows ?? []).filter((line) => {
    if (line.accountId === context.accountId || line.origin === "investments") return false;
    const cents = parseCents(line.amount);
    return deposit ? cents < 0n : cents > 0n;
  });
}

export function CounterpartField({
  id,
  context,
  kind,
  day,
  value,
  onChange,
}: {
  id: string;
  context: ServiceContext;
  kind: "deposit" | "withdrawal";
  day: string;
  value: string;
  onChange: (choice: string) => void;
}) {
  const text = useTranslations("investments.portfolioOps.counterpart");
  const deposit = kind === "deposit";
  const bank = useBankMovements(context, day, deposit);
  const accounts = (useApi(accountRoutes.listAccounts, { query: {} }).data?.accounts ?? []).filter(
    (account) => account.id !== context.accountId,
  );
  return (
    <div className="col-span-full">
      <Field label={text(deposit ? "from" : "to")} htmlFor={`${id}-counterpart`} hint={text("hint")}>
        <Select id={`${id}-counterpart`} value={value} onChange={(event) => onChange(event.target.value)}>
          <option value={AUTOMATIC}>{text("automatic")}</option>
          {bank.length > 0 && (
            <optgroup label={text("movements")}>
              {bank.map((line) => (
                <option key={line.id} value={`tx:${line.id}`}>
                  {text("movementOption", {
                    date: formatDate(line.on, "dayMonth", context.locale),
                    payee: line.payee?.trim() || text("noPayee"),
                    amount: formatMoney(parseCents(line.amount), context.numberFormat),
                    account: line.accountName ?? "",
                  })}
                </option>
              ))}
            </optgroup>
          )}
          {accounts.length > 0 && (
            <optgroup label={text("accounts")}>
              {accounts.map((account) => (
                <option key={account.id} value={`acc:${account.id}`}>
                  {account.name}
                </option>
              ))}
            </optgroup>
          )}
          <option value="outside">{text("outside")}</option>
          <option value="none">{text(deposit ? "noneIn" : "noneOut")}</option>
        </Select>
      </Field>
    </div>
  );
}
