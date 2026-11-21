import { permanentRedirect } from "next/navigation";
import { legacyPeriodQuery, type Query } from "@ledgerly/domain/investments";
import { today } from "@ledgerly/domain/shared/dates";
import { withParams } from "@ledgerly/ui/url";
import { ServiceScreen } from "@/modules/investments/client";
import { requireSession } from "@/platform/auth/session";
import { appRoute } from "@/platform/route";

/**
 * A service's Overview (docs/design/investments-ux.md §3.3, U3). The page reads no data (rewrite plan
 * R3): the screen reads `GET /investments/{accountId}`. It keeps the redirect of the chart's old
 * address (`range`, months, `grain`), which needs no data (§1.2).
 */
export default async function InvestmentServiceOverview({
  params,
  searchParams,
}: PageProps<"/investments/[accountId]">) {
  const ctx = await requireSession();
  const { accountId } = await params;
  const legacy = legacyPeriodQuery((await searchParams) as Query, today(ctx.timeZone));
  if (legacy) permanentRedirect(appRoute(withParams(`/investments/${accountId}`, {}, legacy)));
  return <ServiceScreen id={accountId} tab="overview" />;
}

export const dynamic = "force-dynamic";
