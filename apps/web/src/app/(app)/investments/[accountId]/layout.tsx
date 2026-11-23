import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { holderOf } from "./holder";
import { HolderProvider } from "./holder-screen";

/** The service's or the fund's name as the title, with the 404 below; both read `/api/v1` (`apiRead`). */
export async function generateMetadata({
  params,
}: LayoutProps<"/investments/[accountId]">): Promise<Metadata> {
  const { accountId } = await params;
  const holder = await holderOf(accountId);
  return { title: holder?.name ?? (await getTranslations("investments"))("title") };
}

/**
 * Above the tabs' screens, so another person's account, or an account that is neither a service nor
 * a pension fund, answers a real 404. It hands what holds the account to the tabs, which read nothing
 * on the server: their screens read `/api/v1` on the client.
 */
export default async function InvestmentAccountLayout({
  children,
  params,
}: LayoutProps<"/investments/[accountId]">) {
  const { accountId } = await params;
  const holder = await holderOf(accountId);
  if (!holder) notFound();
  return <HolderProvider holder={holder}>{children}</HolderProvider>;
}
