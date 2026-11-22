import type { Metadata } from "next";
import { permanentRedirect, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { isFutureYear } from "@ledgerly/domain/funds/client";
import type { Query } from "@ledgerly/domain/investments";
import { legacyPeriodQuery } from "@ledgerly/domain/investments/client";
import { requireSession } from "@/platform/auth/session";
import { today } from "@ledgerly/domain/shared/dates";
import { type Params, withParams } from "@ledgerly/ui/url";
import { appRoute } from "@/platform/route";
import { FundsScreen } from "@/modules/funds/client";

const PATH = "/funds";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("funds"))("title") };
}

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/**
 * Funds · the new home (docs/design/funds-ux.md §5.3, §6, F2, mockups a-01 to a-04): the gain of the
 * period first, then what explains it, the chart, the funds, and who paid in. The period is in the
 * address and drives every number here but "On the way" and the recurring debits, which stay as of today.
 *
 * The page reads no data (rewrite plan R3): the screen reads `GET /funds`. It keeps the redirects of an old
 * address, which need no data, so that they stay real redirects. No `loading.tsx`: it would also cover
 * `/funds/[id]`, whose 404 must stay a real one.
 */
export default async function FundsHomePage({ searchParams }: PageProps<"/funds">) {
  const ctx = await requireSession();
  const query = (await searchParams) as Query;
  const todayOn = today(ctx.timeZone);

  const legacy = legacyPeriodQuery(query, todayOn);
  if (legacy) permanentRedirect(appRoute(withParams(PATH, {}, legacy)));
  const view = (["value", "return"] as const).find((key) => key === one(query.view)) ?? "gain";
  const kept: Params = { view: view === "gain" ? undefined : view };
  if (isFutureYear(one(query.period), todayOn)) redirect(appRoute(withParams(PATH, kept, {})));
  return <FundsScreen />;
}

export const dynamic = "force-dynamic";
