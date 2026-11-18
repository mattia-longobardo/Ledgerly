// The numbers of a fund's page (docs/design/funds-ux.md §5.3, §6, F3). Pure, and on top of `home.ts`:
// a fund's page is the home of that one fund, so its gain and its return cannot differ from its row.
import type { CivilDate } from "../../platform/dates";
import { type FundLine, firstDataOn, type HomeFund, type HomeSummary, homeSummary, lineOf } from "./home";
import type { FundPeriod } from "./period";
import type { FundForecast } from "./rules";

export interface FundSummary {
  firstOn: CivilDate | null;
  summary: HomeSummary;
  /** Always there: the home leaves out a fund with nothing to say, and here it is the whole page. */
  line: FundLine;
  /**
   * The period ends before the fund's first data, and nothing measures it. A first value on the 1st
   * with no money before it is seen by the month before as a gain of 0: the fund's row in the home
   * says so, and so must its page.
   */
  beforeFirst: boolean;
}

export function fundSummary(input: {
  fund: HomeFund;
  period: FundPeriod & { year?: number | null };
  todayOn: CivilDate;
}): FundSummary {
  const { fund, period, todayOn } = input;
  const firstOn = firstDataOn([fund]);
  const summary = homeSummary({ funds: [fund], period, todayOn, firstOn });
  const line = summary.lines[0] ?? lineOf(fund, period);
  return {
    firstOn,
    summary,
    line,
    beforeFirst: summary.state === "before_first" && line.status !== "measured",
  };
}

/**
 * The projection with the hypotheses alone. The fund's own yearly rate is a compound of its stretches:
 * beside the return of the period it would be a second return on the page, which decision 2 of §9 rules out.
 */
export function hypothesesOnly(forecast: FundForecast): FundForecast {
  if (forecast.ownRate === null) return forecast;
  return {
    ...forecast,
    ownRate: null,
    rates: forecast.rates.slice(0, -1),
    rows: forecast.rows.map((row) => ({ ...row, valueCents: row.valueCents.slice(0, -1) })),
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** An id the database can be asked about: anything else is a page that does not exist. */
export const isFundId = (id: string): boolean => UUID.test(id);
