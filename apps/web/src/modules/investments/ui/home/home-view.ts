// What the parts of the Investments home share (rewrite plan R3): the answer of `GET /investments/home`,
// the person's way of writing figures, and the links that keep the period and the chart's choices.
import type { RouteOutput } from "@ledgerly/api-client";
import type { investments } from "@ledgerly/api-contract/investments";
import type { SectionQuery } from "@ledgerly/ui/period";
import { type Params, withParams } from "@ledgerly/ui/url";
import type { Say } from "@/platform/say";
import { colorOf, type Money, moneyIn, type Percent, percentIn } from "../present";

export type Home = RouteOutput<typeof investments.getInvestmentsHome>;
export type HomeService = Home["services"][number];
export type ChartView = "pnl" | "return" | "value";
export type GroupBy = "service" | "class" | "ccy";

export interface HomeContext {
  home: Home;
  say: Say;
  section: SectionQuery;
  view: ChartView;
  by: GroupBy;
  /** The period in words: «2026 · year to date», «since…». */
  name: string;
  money: Money;
  percent: Percent;
  /** The colour of a service: its account's, or the palette's at its place. */
  colorOf: (service: HomeService) => string;
  serviceHref: (accountId: string) => string;
  /** An alert opens the Connection tab of its service, where the thing to check is (§3.1, U3). */
  alertHref: (accountId: string) => string;
  /** The chart's view and the composition's grouping, as the period's links carry them. */
  kept: Params;
}

export function homeContext(
  home: Home,
  say: Say,
  section: SectionQuery,
  choices: { view: ChartView; by: GroupBy; name: string },
): HomeContext {
  const kept: Params = {
    view: choices.view === "pnl" ? undefined : choices.view,
    by: choices.by === "service" ? undefined : choices.by,
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
