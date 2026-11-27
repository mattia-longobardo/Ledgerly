// What the parts of the Investments home share (rewrite plan R3): the answer of `GET /investments/home`,
// the person's way of writing figures, and the links that keep the period and the chart's choices.
import { PALETTE } from "@ledgerly/design-tokens";
import type { RouteOutput } from "@ledgerly/api-client";
import type { investments } from "@ledgerly/api-contract/investments";
import type { SectionQuery } from "@ledgerly/ui/period";
import { type Params, withParams } from "@ledgerly/ui/url";
import type { Say } from "@/platform/say";
import { colorOf, type Money, moneyIn, type Percent, percentIn } from "../present";

type Home = RouteOutput<typeof investments.getInvestmentsHome>;
export type HomeService = Home["services"][number];
export type ChartView = "pnl" | "return" | "value";
export type GroupBy = "service" | "class" | "ccy";
/** The chips of the one list (R5b): every group, or one of the two. */
export const CHIPS = ["all", "stocks_crypto", "pension_funds"] as const;
type Chip = (typeof CHIPS)[number];
type Series = Home["chart"]["services"][number];

/** The KPIs of a chip: the total for «All», the group's for the others; null for a group with no row. */
export const chipKpis = (home: Home, chip: Chip): Home["total"] | null =>
  chip === "all" ? home.total : (home.groups.find((group) => group.id === chip)?.kpis ?? null);

/** One layer of the chart: a service or a pension fund, as the rows of the list name them. */
export interface ChartLayer {
  key: string;
  label: string;
  color: string;
  series: Series;
}

/**
 * The chart's layers, in the order of the list: the services, then the pension funds the server drew
 * for the chip. A fund has no colour of its own here: the palette's, after the services'.
 */
export function chartLayers(home: Home): ChartLayer[] {
  const series = new Map(
    [...home.chart.services, ...(home.chart.funds ?? [])].map((one) => [one.accountId, one]),
  );
  const services = home.services.flatMap((service) => {
    const one = series.get(service.accountId);
    return one ? [{ key: service.accountId, label: service.name, color: colorOf(service), series: one }] : [];
  });
  const funds = home.groups
    .filter((group) => group.id === "pension_funds")
    .flatMap((group) => group.rows)
    .flatMap((row) => {
      const one = series.get(row.accountId);
      return one ? [{ key: row.accountId, label: row.name, series: one }] : [];
    })
    .map((fund, index) => ({ ...fund, color: PALETTE[(home.services.length + index) % PALETTE.length]! }));
  return [...services, ...funds];
}

export interface HomeContext {
  home: Home;
  say: Say;
  section: SectionQuery;
  view: ChartView;
  by: GroupBy;
  chip: Chip;
  /** The period in words: «2026 · year to date», «since…». */
  name: string;
  money: Money;
  percent: Percent;
  /** The colour of a service: its account's, or the palette's at its place. */
  colorOf: (service: HomeService) => string;
  serviceHref: (accountId: string) => string;
  /** An alert opens the Connection tab of its service, where the thing to check is (§3.1, U3). */
  alertHref: (accountId: string) => string;
  /** The chart's view, the composition's grouping and the chip, as the period's links carry them. */
  kept: Params;
}

export function homeContext(
  home: Home,
  say: Say,
  section: SectionQuery,
  choices: { view: ChartView; by: GroupBy; chip: Chip; name: string },
): HomeContext {
  const kept: Params = {
    view: choices.view === "pnl" ? undefined : choices.view,
    by: choices.by === "service" ? undefined : choices.by,
    group: choices.chip === "all" ? undefined : choices.chip,
  };
  return {
    home,
    say,
    section,
    ...choices,
    money: moneyIn(say, home.currency),
    percent: percentIn(say),
    colorOf,
    serviceHref: (accountId) => withParams(`/investments/${accountId}`, {}, section.params),
    alertHref: (accountId) => withParams(`/investments/${accountId}/connection`, {}, section.params),
    kept,
  };
}
