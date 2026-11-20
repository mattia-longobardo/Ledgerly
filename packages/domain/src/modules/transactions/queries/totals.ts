import { sql } from "drizzle-orm";
import type { Ctx } from "../../../platform/context";
import type { CivilDate } from "../../../shared/dates";
import { type Cents, type Converter, type DatedMoney, sumMoney } from "../../../shared/money";
import { transactions } from "../schema";
import { cents, dayExpression } from "./filters";

/** How a total of movements is split in SQL before `gather` adds it up again (audit TR-4). */
interface Split {
  currency: string;
  on: CivilDate | null;
}

/**
 * The two columns that split a total by currency, placed **last** in its select so `GROUP BY` can
 * name them by position (`splitPositions`). The day only for a currency that is not the display
 * one: a range all in the display currency stays one row a group, as before the split.
 */
export function splitColumns(ctx: Pick<Ctx, "timeZone" | "displayCurrency">) {
  return {
    currency: transactions.currency,
    on: sql<CivilDate | null>`case when ${transactions.currency} <> ${ctx.displayCurrency} then ${dayExpression(ctx.timeZone)} end`,
  };
}

/** The `GROUP BY` positions of `splitColumns` after `before` other columns of the select. */
export function splitPositions(before: number) {
  return [sql.raw(String(before + 1)), sql.raw(String(before + 2))];
}

/** Adds up split amounts into one total in the display currency. */
type Totaller = (amounts: readonly DatedMoney[]) => Cents;

/** Before decision D4: every currency counted 1:1, as each total of movements always did. */
const ONE_TO_ONE: Converter = (money) => money.cents;

/** The one way the totals of movements add amounts up (audit TR-4): `sumMoney` into the display currency. */
export function totallerFor(ctx: Pick<Ctx, "displayCurrency">): Promise<Totaller> {
  return Promise.resolve((amounts) => sumMoney(amounts, ctx.displayCurrency, ONE_TO_ONE).total);
}

/**
 * Split rows gathered back into one per `keyOf`, in the order they come, with the counts (`total`)
 * added and `sum(column)` the money of one column through `totalOf`.
 */
export function gather<Row extends Split & { total?: number | string }>(
  rows: readonly Row[],
  keyOf: (row: Row) => string,
  totalOf: Totaller,
): { row: Row; count: number; sum: (money: (row: Row) => string | null) => Cents }[] {
  const groups = new Map<string, Row[]>();
  for (const row of rows) {
    const key = keyOf(row);
    const group = groups.get(key);
    if (group) group.push(row);
    else groups.set(key, [row]);
  }
  return [...groups.values()].map((group) => ({
    row: group[0],
    count: group.reduce((sum, row) => sum + Number(row.total ?? 0), 0),
    sum: (money) =>
      totalOf(
        group.map((row) => ({ money: { cents: cents(money(row)), currency: row.currency }, on: row.on })),
      ),
  }));
}
