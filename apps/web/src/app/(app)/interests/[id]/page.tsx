import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { getTranslations } from "next-intl/server";
import { InterestError, ruleDetail } from "@ledgerly/domain/interests";
import { requireSession } from "@/platform/auth/session";
import { RuleScreen } from "./rule-screen";

/**
 * The account of the rule, or 404: the title and the status of the answer, which only a server read
 * can give before the page is drawn. M10: a necessary server read, as on a pocket's and a budget's
 * page (decision A); `cache` shares it between the title and the page. Everything the page shows
 * comes from `/api/v1`.
 */
const nameOf = cache(async (id: string): Promise<string> => {
  try {
    return (await ruleDetail(await requireSession(), id)).accountName;
  } catch (error) {
    if (error instanceof InterestError) notFound();
    throw error;
  }
});

export async function generateMetadata({ params }: PageProps<"/interests/[id]">): Promise<Metadata> {
  return { title: `${(await getTranslations("interests"))("title")} · ${await nameOf((await params).id)}` };
}

/** One rule (plan F4 §3.6.12): its payouts reconciled with what was paid (spec §7.6), and its days. */
export default async function RulePage({ params }: PageProps<"/interests/[id]">) {
  const { id } = await params;
  await nameOf(id);
  return <RuleScreen id={id} />;
}
