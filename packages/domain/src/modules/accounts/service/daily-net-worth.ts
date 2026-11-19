import type { Ctx } from "../../../platform/context";
import { convertCents } from "../../../platform/fx/rules";
import { ratesOn } from "../../../platform/fx/service";
import type { CivilDate } from "../../../shared/dates";
import type { Cents } from "../../../shared/money";
import type { Account } from "../queries";
import { reconstructedBalances } from "./derived-balances";

/**
 * The net worth day by day (spec §7.1, F2.5) in the display currency: each account of `counted`
 * rebuilt for every day of the window, converted at the rate of its day like the month ends, and
 * summed like the net worth — unknown only when every account is. `counted` is the caller's: the
 * accounts it already read, «in the net worth». No rate is read when nothing needs one.
 */
export async function dailyNetWorth(
  ctx: Pick<Ctx, "userId" | "timeZone" | "displayCurrency">,
  counted: readonly Pick<Account, "id" | "currency">[],
  window: { from: CivilDate; to: CivilDate },
) {
  const currency = ctx.displayCurrency;
  const read = await reconstructedBalances(
    ctx,
    counted.map((account) => account.id),
    window,
  );
  const rates = await ratesOn(
    counted.some((account) => account.currency !== currency)
      ? [currency, ...counted.map((account) => account.currency)]
      : [],
    window.from,
    window.to,
  );
  const accounts = counted.map((account) => {
    const series = read.series.get(account.id);
    return {
      id: account.id,
      values: read.days.map((day, index) => {
        const cents = series?.values[index] ?? null;
        return cents === null ? null : convertCents(cents, account.currency, currency, day, rates);
      }),
      estimated: read.days.map((_day, index) => series?.estimated[index] ?? false),
    };
  });
  return {
    currency,
    days: read.days,
    accounts,
    total: read.days.map((_day, index) =>
      accounts.reduce<Cents | null>((sum, account) => {
        const value = account.values[index];
        return value === null ? sum : (sum ?? 0n) + value;
      }, null),
    ),
    estimated: read.days.map((_day, index) => accounts.some((account) => account.estimated[index])),
  };
}
