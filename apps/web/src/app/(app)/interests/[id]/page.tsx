import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { getTranslations } from "next-intl/server";
import { interests } from "@ledgerly/api-contract/interests";
import { apiRead } from "@/platform/api-read";
import { RuleScreen } from "./rule-screen";

/**
 * The account of the rule, or 404: the title and the status of the answer, which only the server can
 * give before the page is drawn. It asks `/api/v1` (`apiRead`); `cache` shares the read between the
 * title and the page. Everything the page shows comes from the screen.
 */
const nameOf = cache(async (id: string): Promise<string> => {
  const rule = await apiRead(interests.getInterestRule, { params: { id } });
  if (!rule) notFound();
  return rule.rule.account;
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
