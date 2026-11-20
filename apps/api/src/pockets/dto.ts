// Pockets · the one serializer of a pocket (audit API-2): `GET /pockets`, its MCP tool `list_pockets`,
// a pocket's page and the export of the pages answer through these, so a field is written one way.
// Money leaves as a decimal string.
import type { z } from "zod";
import type { POCKETS } from "@ledgerly/api-contract";
import type { PocketView, pocketsView } from "@ledgerly/domain/pockets";
import { addMonths } from "@ledgerly/domain/shared/dates";
import { type Cents, centsToDecimal } from "@ledgerly/domain/shared/money";

type Row = z.input<typeof POCKETS.pockets.listPockets.response>["pockets"][number];
type Page = z.input<typeof POCKETS.pockets.getPocket.response>;

export const money = centsToDecimal;
export const maybe = (cents: Cents | null): string | null => (cents === null ? null : money(cents));

/** The row of `list_pockets` and of a pocket's card. */
export function pocketRow(view: PocketView): Row {
  const { pocket } = view;
  return {
    id: pocket.id,
    name: pocket.name,
    color: pocket.color,
    state: pocket.state,
    accountId: pocket.backingAccountId,
    account: view.accountName,
    startMonth: pocket.startMonth,
    target: maybe(pocket.targetCents),
    monthly: maybe(pocket.monthlyCents),
    balance: money(view.balanceCents),
    percent: view.percent,
    planned: {
      count: view.planned.length,
      total: money(view.plannedCents),
      after: money(view.projectedCents),
    },
  };
}

/** A pocket's page: its row, the target's progress, the interest, the history, expenses and plans. */
export function pocketPage(view: Awaited<ReturnType<typeof pocketsView>>, selected: PocketView): Page {
  const { pocket } = selected;
  const target = pocket.targetCents;
  const thisMonth = view.months[view.months.length - 1];
  return {
    pocket: {
      ...pocketRow(selected),
      budget: money(selected.budgetCents),
      accrued: money(selected.accruedCents),
      spent: money(selected.spentCents),
      toGo: target !== null && selected.balanceCents < target ? money(target - selected.balanceCents) : null,
      eta: selected.eta,
      etaMonth: selected.eta === null ? null : addMonths(thisMonth, selected.eta),
      interest: maybe(selected.interestCents),
      interestReason: selected.interestReason,
      freeOnAccount: pocket.backingAccountId
        ? maybe(view.freeByAccount[pocket.backingAccountId] ?? null)
        : null,
    },
    history: view.months.map((month, index) => ({ month, balance: maybe(selected.history[index]) })),
    expenses: selected.expenses.map((expense) => ({
      id: expense.id,
      on: expense.on,
      amount: money(expense.cents),
      payee: expense.payee,
      note: expense.note,
      account: expense.accountName,
      linked: expense.linked,
      manual: expense.manual,
    })),
    planned: selected.planned.map((row) => ({
      id: row.id,
      description: row.description,
      amount: money(row.cents),
      dueOn: row.dueOn,
      overdue: row.overdue,
    })),
  };
}
