import type { Metadata } from "next";
import { permanentRedirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import type { Query } from "@ledgerly/domain/investments";
import { legacyPeriodQuery } from "@ledgerly/domain/investments/client";
import { today } from "@ledgerly/domain/shared/dates";
import { withParams } from "@ledgerly/ui/url";
import { InvestmentsHomeScreen } from "@/modules/investments/client";
import { requireSession } from "@/platform/auth/session";
import { appRoute } from "@/platform/route";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("investments"))("title") };
}

/**
 * Investments · Profit & loss (docs/design/investments-ux.md §3.1, U2). The page reads no data (rewrite
 * plan R3): the screen reads `GET /investments/home`. It keeps the redirect of the charts' old address
 * (`range`, months, `grain`), which needs no data, so that it stays a real redirect (§1.2).
 */
export default async function InvestmentsPage({ searchParams }: PageProps<"/investments">) {
  const ctx = await requireSession();
  const legacy = legacyPeriodQuery((await searchParams) as Query, today(ctx.timeZone));
  if (legacy) permanentRedirect(appRoute(withParams("/investments", {}, legacy)));
  return <InvestmentsHomeScreen />;
}

export const dynamic = "force-dynamic";
