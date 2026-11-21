import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { requireSession } from "@/platform/auth/session";
import { yearOf } from "@/modules/timeoff/client";
import { trekStatsOf } from "@ledgerly/domain/platform/integrations/trek";
import { today } from "@ledgerly/domain/shared/dates";
import { TimeOffScreen } from "./timeoff-screen";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("timeoff"))("title") };
}

/**
 * Time off reads everything it shows from `/api/v1` (rewrite plan R3), save one line: Trek's own
 * figures are the plugin's, not the read-model's (TOF-4), and stay a read of the server until R5c,
 * where the plugin answers them. A necessary read, with its reason (M10).
 */
export default async function TimeOffPage({ searchParams }: PageProps<"/timeoff">) {
  const ctx = await requireSession();
  const year = yearOf((await searchParams).year, Number(today(ctx.timeZone).slice(0, 4)), 2200);
  return <TimeOffScreen external={await trekStatsOf(ctx, year)} />;
}
