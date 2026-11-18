// src/app/(app)/expenses/row-view.ts — one movement as the table of Expenses draws it, built on the
// server: every text already formatted, every colour already decided. Shared by Expenses and by
// "To review", which shows its single movements in the same table. What only one source can do
// with a row is added by the page that knows that source.
import type { TransactionRow } from "@ledgerly/domain/transactions";
import { displayPayee, isHidden, macrosFor } from "@ledgerly/domain/transactions";
import { amountToneOf, badgesOf } from "@/modules/transactions/ui/display";
import type { RowView } from "@/modules/transactions/ui/view";
import type { Ctx } from "@ledgerly/domain/platform/context";
import { formatAmountInput, formatDate, formatMoney, NULL_DISPLAY } from "@ledgerly/domain/platform/format";

export function rowViewOf(
  row: TransactionRow,
  {
    ctx,
    colorOf,
    categories,
    sendSources,
  }: {
    ctx: Pick<Ctx, "locale" | "numberFormat">;
    /** One colour per category, decided once for the screen (`categoryColors`). */
    colorOf: ReadonlyMap<string, string>;
    /** The person's categories as the screen offers them: where a suggestion's name is read. */
    categories: readonly { id: string; name: string; color: string }[];
    /** The source each account sends its manual movements to, where a row on the screen waits. */
    sendSources?: ReadonlyMap<string, string>;
  },
): RowView {
  const money = (cents: bigint) => formatMoney(cents, ctx.numberFormat);
  const suggested = categories.find((category) => category.id === row.suggestedCategoryId) ?? null;
  return {
    id: row.id,
    date: formatDate(row.on, "long", ctx.locale),
    payee: displayPayee(row.payee),
    account: row.accountName ?? NULL_DISPLAY,
    categoryId: row.categoryId,
    categoryName: row.categoryName,
    categoryColor: row.categoryId === null ? null : (colorOf.get(row.categoryId) ?? row.categoryColor),
    categoryState: row.categoryState,
    categoryReason: row.categoryReason,
    suggestion: suggested ? { id: suggested.id, name: suggested.name, color: suggested.color } : null,
    amount: money(row.amountCents),
    amountTone: amountToneOf(row),
    macros: macrosFor(row),
    paired: row.transferGroupId !== null,
    badges: badgesOf(row),
    hidden: isHidden(row),
    note: row.note,
    labels: row.labels.map((label) => label.name),
    labelIds: row.labels.map((label) => label.id),
    manual:
      row.origin === "manual" && row.type !== "transfer"
        ? {
            kind: row.type,
            amount: formatAmountInput(
              row.amountCents < 0n ? -row.amountCents : row.amountCents,
              ctx.numberFormat,
            ),
            on: row.on,
            accountId: row.accountId,
            payee: row.payee ?? "",
          }
        : null,
    send:
      row.origin === "manual" && row.sendState !== null
        ? { state: row.sendState, source: sendSources?.get(row.accountId) ?? row.accountName ?? NULL_DISPLAY }
        : null,
  };
}
