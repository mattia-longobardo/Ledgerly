import { notFound, permanentRedirect, redirect } from "next/navigation";
import { isFutureYear, legacyFundQuery } from "@ledgerly/domain/funds/client";
import type { Query } from "@ledgerly/domain/investments";
import { legacyPeriodQuery, sectionPeriod } from "@ledgerly/domain/investments/client";
import { type CivilDate, today } from "@ledgerly/domain/shared/dates";
import { withParams } from "@ledgerly/ui/url";
import { FundScreen } from "@/modules/funds/client";
import { ServiceScreen } from "@/modules/investments/client";
import { requireSession } from "@/platform/auth/session";
import { appRoute } from "@/platform/route";
import { holderOf } from "./holder";

/** The tabs of a fund: the same four for every fund. */
const FUND_TABS = ["overview", "contributions", "valuations", "settings"] as const;

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/**
 * The redirects of a fund's old addresses, which need no data (docs/design/funds-ux.md §6, F3): the
 * period's old form, the tab of the deposits, a year to come.
 */
function fundRedirects(base: string, query: Query, todayOn: CivilDate): void {
  const legacy = legacyFundQuery(query, todayOn);
  if (legacy) permanentRedirect(appRoute(withParams(base, {}, legacy)));
  // The tab of the deposits is the tab of the contributions now: an address saved before still opens it.
  if (one(query.tab) === "deposits") {
    const kept = { ...sectionPeriod(query, todayOn).params, view: one(query.view) };
    redirect(appRoute(withParams(base, kept, { tab: "contributions" })));
  }
  if (isFutureYear(one(query.period), todayOn)) {
    const tab = FUND_TABS.find((name) => name === one(query.tab) && name !== "overview");
    const view = (["value", "return"] as const).find((key) => key === one(query.view));
    redirect(appRoute(withParams(base, { tab, view }, {})));
  }
}

/**
 * A service's Overview (docs/design/investments-ux.md §3.3, U3), or a pension fund's page (rewrite plan
 * R5b, B1b; funds-ux.md §5.3, §6, F3; ux/n6-pension-fund.md §5): one detail for both, `PortfolioDetail`.
 * The page reads no data (rewrite plan R3): the screen reads `/api/v1`. It keeps the redirects of the old
 * addresses, which need no data (§1.2), so that they stay real redirects; the layout answers the 404.
 */
export default async function InvestmentAccountOverview({
  params,
  searchParams,
}: PageProps<"/investments/[accountId]">) {
  const ctx = await requireSession();
  const { accountId } = await params;
  const holder = await holderOf(accountId);
  if (!holder) notFound();
  const query = (await searchParams) as Query;
  const todayOn = today(ctx.timeZone);
  const base = `/investments/${accountId}`;
  if (holder.kind === "fund") {
    fundRedirects(base, query, todayOn);
    return <FundScreen id={holder.fundId} accountId={accountId} />;
  }
  const legacy = legacyPeriodQuery(query, todayOn);
  if (legacy) permanentRedirect(appRoute(withParams(base, {}, legacy)));
  return <ServiceScreen id={accountId} tab="overview" />;
}

export const dynamic = "force-dynamic";
