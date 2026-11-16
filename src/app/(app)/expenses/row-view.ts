// src/app/(app)/expenses/row-view.ts — one movement as the table of Expenses draws it, built on the
// server: every text already formatted, every colour already decided. Shared by Expenses and by
// "To review", which shows its single movements in the same table.
import type { TransactionRow } from "@/modules/transactions/queries";
import { displayPayee, isHidden } from "@/modules/transactions/rules";
import { amountToneOf, badgesOf, categoryColor } from "@/modules/transactions/ui/display";
import type { RowView } from "@/modules/transactions/ui/view";
import type { Ctx } from "@/platform/context";
import { formatAmountInput, formatDate, formatMoney, NULL_DISPLAY } from "@/platform/format";

export function rowViewOf(
  row: TransactionRow,
  {
    ctx,
    colorOf,
    walletIds,
  }: {
    ctx: Pick<Ctx, "locale" | "numberFormat">;
    /** One colour per category, decided once for the screen (`categoryColors`). */
    colorOf: ReadonlyMap<string, string>;
    /** The movements whose fields the details panel may write to their source. */
    walletIds: ReadonlySet<string>;
  },
): RowView {
  const money = (cents: bigint) => formatMoney(cents, ctx.numberFormat);
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
    suggestion:
      row.suggestion === null
        ? null
        : {
            id: row.suggestion.id,
            name: row.suggestion.name,
            color: colorOf.get(row.suggestion.id) ?? categoryColor(row.suggestion.color, 0),
          },
    amount: money(row.amountCents),
    amountTone: amountToneOf(row),
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
    wallet: walletIds.has(row.id)
      ? {
          type: row.type,
          amount: formatAmountInput(
            row.amountCents < 0n ? -row.amountCents : row.amountCents,
            ctx.numberFormat,
          ),
        }
      : null,
  };
}
