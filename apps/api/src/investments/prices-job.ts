// `instrument-prices` (rewrite plan R5d): the daily closes of the markets whose price is automatic,
// read once for the instance through its prices plugin, then every manual portfolio on a changed
// market rewritten from its oldest changed day. With no prices plugin, the job does nothing.
import { DEFAULT_DAILY_CALLS, refreshPrices } from "@ledgerly/domain/instruments";
import { pricedMarkets, revalueAfterPrices } from "@ledgerly/domain/investments";
import type { Ctx } from "@ledgerly/domain/platform/context";
import type { JobDetail } from "@ledgerly/domain/platform/jobs";
import { pricesPlugin } from "@ledgerly/domain/platform/plugins";
import { today } from "@ledgerly/domain/shared/dates";
import { forEachUser } from "@ledgerly/domain/users";
import { pluginPriceSource } from "@ledgerly/plugin-host";

export async function refreshInstrumentPrices(now: Date = new Date()): Promise<JobDetail> {
  const plugin = await pricesPlugin();
  if (!plugin) return { plugin: false };
  const people: { ctx: Ctx; markets: Awaited<ReturnType<typeof pricedMarkets>> }[] = [];
  await forEachUser(
    "instrument-prices",
    async (_person, ctx) => {
      people.push({ ctx, markets: await pricedMarkets(ctx) });
    },
    { addon: "investments" },
  );
  const run = await refreshPrices({
    source: pluginPriceSource(plugin.config),
    markets: people.flatMap((person) => person.markets),
    today: today("UTC", now),
    cap: DEFAULT_DAILY_CALLS,
  });
  let portfolios = 0;
  for (const person of people) portfolios += await revalueAfterPrices(person.ctx, run);
  return { plugin: true, read: run.read, changed: run.changed.size, partial: run.partial, portfolios };
}
