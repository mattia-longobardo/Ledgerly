import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { getTranslations } from "next-intl/server";
import { accounts as accountRoutes } from "@ledgerly/api-contract/accounts";
import { apiRead } from "@/platform/api-read";
import { AccountScreen } from "./account-screen";

/**
 * Whether the account exists (an archived account too: its page offers «Restore account»), and its
 * name for the title: the status of the answer, which only the server can give before the page is
 * drawn. It asks `/api/v1` (`apiRead`); `cache` shares the read between the title and the page.
 */
const accountOf = cache((id: string) => apiRead(accountRoutes.getAccount, { params: { id } }));

export async function generateMetadata({ params }: PageProps<"/accounts/[id]">): Promise<Metadata> {
  const account = await accountOf((await params).id);
  return { title: account?.name ?? (await getTranslations("accounts"))("title") };
}

/** An account's page reads everything it shows from `/api/v1` (rewrite plan R3). */
export default async function AccountDetailPage({ params }: PageProps<"/accounts/[id]">) {
  const { id } = await params;
  if (!(await accountOf(id))) notFound();
  return <AccountScreen id={id} />;
}
