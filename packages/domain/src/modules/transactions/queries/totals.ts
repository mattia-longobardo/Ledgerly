import { sql } from "drizzle-orm";
import type { Ctx } from "../../../platform/context";
import { NO_RATES, convertCents, ratesOn } from "../../../platform/fx";
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
 * The columns that split a total by currency, placed **last** in its select so `GROUP BY` can name
 * them by position (`splitPositions`). Unsplit, they are constants — every row taken as in the
 * display currency — and the select keeps the plain aggregate it had before the split; `foreign`
 * counts the movements that are not, so the caller knows whether to read again split
 * (`splitIfForeign`). Split, the day only for a currency that is not the display one.
 */
export function splitColumns(ctx: Pick<Ctx, "timeZone" | "displayCurrency">, split: boolean) {
  const foreign = sql<string>`count(*) filter (where ${transactions.currency} <> ${ctx.displayCurrency})`;
  if (!split) {
    return { currency: sql<string>`${ctx.displayCurrency}::text`, on: sql<CivilDate | null>`null`, foreign };
  }
  return {
    currency: sql<string>`${transactions.currency}`,
    on: sql<CivilDate | null>`case when ${transactions.currency} <> ${ctx.displayCurrency} then ${dayExpression(ctx.timeZone)} end`,
    foreign,
  };
}

/** The `GROUP BY` positions of split `splitColumns` after `before` other columns; none unsplit. */
export function splitPositions(before: number, split: boolean) {
  return split ? [sql.raw(String(before + 1)), sql.raw(String(before + 2))] : [];
}

/**
 * The rows of a total: the plain aggregate first, and only when it counted a movement in another
 * currency the split one (audit TR-4). A person all in the display currency pays one query, as
 * before the split.
 */
export async function splitIfForeign<Row extends { foreign: string }>(
  read: (split: boolean) => PromiseLike<Row[]>,
): Promise<Row[]> {
  const plain = await read(false);
  return plain.some((row) => Number(row.foreign) > 0) ? read(true) : plain;
}

/** Adds up split amounts into one total in the display currency, and says which rows it can convert. */
interface Totaller {
  sum: (amounts: readonly DatedMoney[]) => Cents;
  converts: (split: Split) => boolean;
}

/** The field a total adds when it left movements out for want of a rate (D4): none when it left none. */
export function excludedOf(excluded: number): { excludedCount?: number } {
  return excluded > 0 ? { excludedCount: excluded } : {};
}

/**
 * The one way the totals of movements add amounts up (audit TR-4, decision D4): `sumMoney` into the
 * display currency, a foreign amount converted at the ECB rate of its own day with the accounts'
 * rule (`convertCents`); one with no rate is left out, never counted 1:1. With every row in the
 * display currency no rate is read.
 */
export async function totallerFor(
  ctx: Pick<Ctx, "displayCurrency">,
  rows: readonly Split[],
): Promise<Totaller> {
  const into = ctx.displayCurrency;
  const days = rows.flatMap((row) => (row.on === null ? [] : [row.on])).sort();
  const rates =
    days.length === 0
      ? NO_RATES
      : await ratesOn([into, ...rows.map((row) => row.currency)], days[0], days[days.length - 1]);
  const convert: Converter = (money, day) =>
    day === null ? null : convertCents(money.cents, money.currency, into, day, rates);
  return {
    sum: (amounts) => sumMoney(amounts, into, convert).total,
    converts: (split) =>
      split.currency === into || convert({ cents: 0n, currency: split.currency }, split.on) !== null,
  };
}

/**
 * Split rows gathered back into one per `keyOf`, in the order they come, with the counts (`total`)
 * added, `excluded` the movements of the rows with no rate, and `sum(column)` the money of one
 * column through `totalOf`.
 */
export function gather<Row extends Split & { total?: number | string }>(
  rows: readonly Row[],
  keyOf: (row: Row) => string,
  totalOf: Totaller,
): { row: Row; count: number; excluded: number; sum: (money: (row: Row) => string | null) => Cents }[] {
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
    excluded: group.reduce((sum, row) => sum + (totalOf.converts(row) ? 0 : Number(row.total ?? 0)), 0),
    sum: (money) =>
      totalOf.sum(
        group.map((row) => ({ money: { cents: cents(money(row)), currency: row.currency }, on: row.on })),
      ),
  }));
}
