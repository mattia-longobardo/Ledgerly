import { permanentRedirect, redirect } from "next/navigation";
import { isFutureYear, legacyFundQuery } from "@ledgerly/domain/funds/client";
import type { Query } from "@ledgerly/domain/investments";
import { sectionPeriod } from "@ledgerly/domain/investments/client";
import { today } from "@ledgerly/domain/shared/dates";
import { withParams } from "@ledgerly/ui/url";
import { requireSession } from "@/platform/auth/session";
import { appRoute } from "@/platform/route";
import { HolderScreen } from "./holder-screen";

/** The tabs of a fund: the same four for every fund. */
const FUND_TABS = ["overview", "contributions", "valuations", "settings"] as const;

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/**
 * A service's Overview (docs/design/investments-ux.md §3.3, U3), or a pension fund's page (rewrite plan
 * R5b, B1b; funds-ux.md §5.3, §6, F3; ux/n6-pension-fund.md §5): one detail for both, `PortfolioDetail`.
 * The page reads no data (rewrite plan R3): the layout says what holds the account, the screen reads
 * `/api/v1`. It keeps the redirects of the old addresses, which need no data (§1.2), so that they stay
 * real redirects: the period's old forms, a fund's `span`, its tab of the deposits and a year to come.
 * A service's address has none of the last three.
 */
export default async function InvestmentAccountOverview({
  params,
  searchParams,
}: PageProps<"/investments/[accountId]">) {
  const ctx = await requireSession();
  const { accountId } = await params;
  const query = (await searchParams) as Query;
  const todayOn = today(ctx.timeZone);
  const base = `/investments/${accountId}`;
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
  return <HolderScreen accountId={accountId} tab="overview" />;
}

export const dynamic = "force-dynamic";
