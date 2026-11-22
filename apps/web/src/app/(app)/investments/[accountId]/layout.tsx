import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { views } from "@ledgerly/api-contract/accounts";
import { apiRead } from "@/platform/api-read";
import { accountOf } from "../../accounts/account-read";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The service's name as the title, with the 404 below; both read `/api/v1` (`apiRead`). */
export async function generateMetadata({
  params,
}: LayoutProps<"/investments/[accountId]">): Promise<Metadata> {
  const { accountId } = await params;
  const account = UUID.test(accountId) ? await accountOf(accountId) : null;
  return { title: account?.name ?? (await getTranslations("investments"))("title") };
}

/**
 * Above the tabs' screens, so another person's service, or an account that is no service, answers a
 * real 404. The tabs read `/api/v1` on the client.
 */
export default async function InvestmentServiceLayout({
  children,
  params,
}: LayoutProps<"/investments/[accountId]">) {
  const { accountId } = await params;
  // The account too: the title reads it (`cache`), and the metadata is streamed with the page.
  const [context] = UUID.test(accountId)
    ? await Promise.all([
        apiRead(views.getAccountContext, { params: { id: accountId } }),
        accountOf(accountId),
      ])
    : [null];
  if (!context?.inInvestments) notFound();
  return <>{children}</>;
}
