import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { holderOf } from "./holder";

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
 * a pension fund, answers a real 404. The tabs read `/api/v1` on the client.
 */
export default async function InvestmentAccountLayout({
  children,
  params,
}: LayoutProps<"/investments/[accountId]">) {
  const { accountId } = await params;
  if (!(await holderOf(accountId))) notFound();
  return <>{children}</>;
}
