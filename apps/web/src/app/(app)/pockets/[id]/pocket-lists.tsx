"use client";

// The two lists of a pocket's page: the planned expenses, and the expenses that came off it.
import { useTranslations } from "next-intl";
import type { pockets as pocketRoutes } from "@ledgerly/api-contract/pockets";
import type { RouteOutput } from "@ledgerly/api-client";
import { NULL_DISPLAY } from "@ledgerly/format/format";
import { Badge } from "@ledgerly/ui/badge";
import { Card, CardHeader } from "@ledgerly/ui/card";
import { Table, TBody, Td, Th, THead, Tr } from "@ledgerly/ui/table";
import { RemovePlannedButton, UnlinkExpenseButton } from "@/modules/pockets/client";
import type { PocketFormat } from "./pocket-format";

type Detail = RouteOutput<typeof pocketRoutes.getPocket>;
type Expense = Detail["expenses"][number];

export function PlannedCard({ detail, format }: { detail: Detail; format: PocketFormat }) {
  const text = useTranslations("pockets");
  const { money, date } = format;
  return (
    <Card padded={false} className="min-w-0" data-testid="pocket-planned">
      <CardHeader
        title={text("planned.title")}
        actions={
          <span className="text-sm text-muted tabular-nums">
            {detail.planned.length === 0 ? null : money(detail.pocket.planned.total, { spent: true })}
          </span>
        }
      />
      {detail.planned.length === 0 ? (
        <p className="px-4 pb-4 text-sm text-muted">{text("planned.empty")}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border px-4 pb-2">
          {detail.planned.map((row) => (
            <li key={row.id} className="flex items-center justify-between gap-3 py-2">
              <span className="flex min-w-0 flex-col">
                <span className="truncate font-medium">{row.description}</span>
                <span className="flex items-center gap-1.5 text-sm text-muted">
                  {date(row.dueOn, "long")}
                  {row.overdue && <Badge tone="warn">{text("planned.overdue")}</Badge>}
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-2">
                <span className="text-neg tabular-nums">{money(row.amount, { spent: true })}</span>
                <RemovePlannedButton id={row.id} description={row.description} />
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** How a row of the expenses reads: payee, where it came from, and its «Unlink» on a standalone pocket. */
function useExpenseParts(detail: Detail, format: PocketFormat) {
  const text = useTranslations("pockets");
  const pocket = detail.pocket;
  const payee = (expense: Expense) => expense.payee ?? text("expenses.noPayee");
  return {
    payee,
    where: (expense: Expense) =>
      expense.manual ? text("expenses.manual") : (expense.account ?? NULL_DISPLAY),
    unlink: (expense: Expense) =>
      pocket.accountId === null &&
      expense.linked && (
        <UnlinkExpenseButton
          pocketId={pocket.id}
          transactionId={expense.id}
          label={`${format.date(expense.on, "long")} · ${payee(expense)}`}
        />
      ),
  };
}

function ExpensesTable({ detail, format }: { detail: Detail; format: PocketFormat }) {
  const text = useTranslations("pockets");
  const { payee, where, unlink } = useExpenseParts(detail, format);
  const standalone = detail.pocket.accountId === null;
  return (
    <div className="overflow-x-auto max-md:hidden">
      <Table>
        <THead>
          <Th>{text("expenses.date")}</Th>
          <Th>{text("expenses.payee")}</Th>
          <Th>{text("expenses.account")}</Th>
          <Th align="right">{text("expenses.amount")}</Th>
          {standalone && <Th align="right">{text("expenses.actions")}</Th>}
        </THead>
        <TBody>
          {detail.expenses.map((expense) => (
            <Tr key={expense.id}>
              <Td muted>{format.date(expense.on, "long")}</Td>
              <Td className="max-w-0 truncate font-medium">
                {payee(expense)}
                {expense.note && <span className="ml-2 text-sm font-normal text-muted">{expense.note}</span>}
              </Td>
              <Td muted>{where(expense)}</Td>
              <Td align="right" className="text-neg">
                {format.money(expense.amount, { spent: true })}
              </Td>
              {standalone && <Td align="right">{unlink(expense)}</Td>}
            </Tr>
          ))}
        </TBody>
      </Table>
    </div>
  );
}

/** A phone gets the same rows as a list. */
function ExpensesList({ detail, format }: { detail: Detail; format: PocketFormat }) {
  const { payee, where, unlink } = useExpenseParts(detail, format);
  return (
    <ul className="flex flex-col divide-y divide-border px-4 pb-2 md:hidden">
      {detail.expenses.map((expense) => (
        <li key={expense.id} className="flex items-center justify-between gap-3 py-2">
          <span className="flex min-w-0 flex-col">
            <span className="truncate font-medium">{payee(expense)}</span>
            <span className="truncate text-sm text-muted">
              {format.date(expense.on, "long")} · {where(expense)}
            </span>
          </span>
          <span className="flex shrink-0 items-center gap-2">
            <span className="text-neg tabular-nums">{format.money(expense.amount, { spent: true })}</span>
            {unlink(expense)}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function ExpensesCard({ detail, format }: { detail: Detail; format: PocketFormat }) {
  const text = useTranslations("pockets");
  return (
    <Card padded={false} className="min-w-0" data-testid="pocket-expenses">
      <CardHeader
        title={text("expenses.title")}
        actions={
          <span className="text-sm text-muted">
            {text("expenses.count", { count: detail.expenses.length })}
          </span>
        }
      />
      {detail.expenses.length === 0 ? (
        <p className="px-4 pb-4 text-sm text-muted">
          {detail.pocket.accountId === null ? text("expenses.emptyStandalone") : text("expenses.emptyBacked")}
        </p>
      ) : (
        <>
          <ExpensesTable detail={detail} format={format} />
          <ExpensesList detail={detail} format={format} />
        </>
      )}
    </Card>
  );
}
