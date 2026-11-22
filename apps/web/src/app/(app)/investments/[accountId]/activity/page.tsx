import { notFound, permanentRedirect } from "next/navigation";
import type { Query } from "@ledgerly/domain/investments";
import { legacyPeriodQuery } from "@ledgerly/domain/investments/client";
import { today } from "@ledgerly/domain/shared/dates";
import { withParams } from "@ledgerly/ui/url";
import { ServiceScreen } from "@/modules/investments/client";
import { holderOf } from "../holder";
import { requireSession } from "@/platform/auth/session";
import { appRoute } from "@/platform/route";

/**
 * A service's Activity (docs/design/investments-ux.md §3). The page reads no data (rewrite plan R3): the
 * screen reads `GET /investments/{accountId}/activity`. It keeps the redirect of the period's old
 * address (`period=all`, a year), which needs no data.
 */
export default async function InvestmentServiceActivity({
  params,
  searchParams,
}: PageProps<"/investments/[accountId]/activity">) {
  const ctx = await requireSession();
  const { accountId } = await params;
  // A fund has its four tabs on its page: the tabs of a service are not its own (R5b).
  if ((await holderOf(accountId))?.kind !== "service") notFound();
  const legacy = legacyPeriodQuery((await searchParams) as Query, today(ctx.timeZone));
  if (legacy) permanentRedirect(appRoute(withParams(`/investments/${accountId}/activity`, {}, legacy)));
  return <ServiceScreen id={accountId} tab="activity" />;
}

export const dynamic = "force-dynamic";
