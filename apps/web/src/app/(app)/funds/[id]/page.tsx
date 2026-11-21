import type { Metadata } from "next";
import { notFound, permanentRedirect, redirect } from "next/navigation";
import { FundError, isFundId, isFutureYear, legacyFundQuery, requireFund } from "@ledgerly/domain/funds";
import { sectionPeriod, type Query } from "@ledgerly/domain/investments";
import { requireSession } from "@/platform/auth/session";
import { today } from "@ledgerly/domain/shared/dates";
import { withParams } from "@ledgerly/ui/url";
import { appRoute } from "@/platform/route";
import { FundScreen } from "./fund-screen";

const HOME = "/funds";
/** The tabs of a fund: the same four for every fund. */
const TABS = ["overview", "contributions", "valuations", "settings"] as const;

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/** The fund's name as the title: a necessary read of the server, with the 404 of the layout. */
export async function generateMetadata({ params }: PageProps<"/funds/[id]">): Promise<Metadata> {
  const ctx = await requireSession();
  const { id } = await params;
  if (!isFundId(id)) notFound();
  try {
    return { title: (await requireFund(ctx, id)).name };
  } catch (error) {
    if (error instanceof FundError) notFound();
    throw error;
  }
}

/**
 * A fund's page (docs/design/funds-ux.md §5.3, §6, F3; rewrite plan, ux/n6-pension-fund.md §5): the header,
 * the tabs, the period, the Overview and the tabs that follow the period. One page for every fund: a section
 * appears when the fund's configuration calls for it — a payslip source, its due dates, a recurring debit,
 * payments by hand, unit movements — and never by a kind of fund. The period is in the address and stays from
 * the home to the fund and from a tab to the next. "On the way", the recurring debit and the projection stay
 * as of today.
 *
 * The page reads no data (rewrite plan R3): the screen reads `/api/v1`. It keeps the redirects of an old
 * address, which need no data, so that they stay real redirects; the layout answers the real 404.
 */
export default async function FundDetailPage({ params, searchParams }: PageProps<"/funds/[id]">) {
  const ctx = await requireSession();
  const { id } = await params;
  // The layout answers 404 too, but this page starts beside it: the database never sees such an id.
  if (!isFundId(id)) notFound();
  const query = (await searchParams) as Query;
  const todayOn = today(ctx.timeZone);
  const base = `${HOME}/${id}`;

  const legacy = legacyFundQuery(query, todayOn);
  if (legacy) permanentRedirect(appRoute(withParams(base, {}, legacy)));
  // The tab of the deposits is the tab of the contributions now: an address saved before still opens it.
  if (one(query.tab) === "deposits") {
    redirect(
      appRoute(
        withParams(
          base,
          { ...sectionPeriod(query, todayOn).params, view: one(query.view) },
          { tab: "contributions" },
        ),
      ),
    );
  }
  if (isFutureYear(one(query.period), todayOn)) {
    const tab = TABS.find((name) => name === one(query.tab) && name !== "overview");
    redirect(
      appRoute(
        withParams(
          base,
          { tab, view: (["value", "return"] as const).find((key) => key === one(query.view)) },
          {},
        ),
      ),
    );
  }
  return <FundScreen id={id} />;
}

export const dynamic = "force-dynamic";
