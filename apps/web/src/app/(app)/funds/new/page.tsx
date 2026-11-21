import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Page } from "@ledgerly/ui/shell/page";
import { NewFundScreen } from "@/modules/funds/client";

export async function generateMetadata(): Promise<Metadata> {
  const text = await getTranslations("funds.wizard");
  return { title: text("title") };
}

/**
 * "Add pension fund" (docs/design/rewrite-plan/ux/n6-pension-fund.md §3): a page of its own, four
 * steps of one form. The step is in the address and read by the form itself, so that the browser's
 * Back goes to the step before without a round trip that would lose what was typed. The page reads
 * no data (rewrite plan R3): the screen reads `/api/v1`.
 */
export default async function NewFundPage() {
  const text = await getTranslations("funds");
  return (
    <Page title={text("wizard.title")} parent={{ href: "/funds", label: text("title") }}>
      <NewFundScreen />
    </Page>
  );
}
