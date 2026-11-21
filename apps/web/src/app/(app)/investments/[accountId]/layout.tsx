import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getAccount } from "@ledgerly/domain/accounts";
import { serviceAccountIds } from "@ledgerly/domain/investments";
import { requireSession } from "@/platform/auth/session";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The service's name as the title: a necessary read of the server, with the 404 below. */
export async function generateMetadata({
  params,
}: LayoutProps<"/investments/[accountId]">): Promise<Metadata> {
  const ctx = await requireSession();
  const { accountId } = await params;
  const account = UUID.test(accountId) ? await getAccount(ctx, accountId) : null;
  return { title: account?.name ?? (await getTranslations("investments"))("title") };
}

/**
 * Above the tabs' screens, so another person's service, or an account that is no service, answers a
 * real 404 (a necessary read of the server, rewrite plan R3). The tabs read `/api/v1` on the client.
 */
export default async function InvestmentServiceLayout({
  children,
  params,
}: LayoutProps<"/investments/[accountId]">) {
  const ctx = await requireSession();
  const { accountId } = await params;
  if (!UUID.test(accountId) || !(await serviceAccountIds(ctx, [accountId])).has(accountId)) notFound();
  return <>{children}</>;
}
