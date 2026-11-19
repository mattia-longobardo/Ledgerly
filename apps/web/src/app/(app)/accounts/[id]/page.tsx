import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getAccount } from "@ledgerly/domain/accounts";
import { requireSession } from "@/platform/auth/session";
import { AccountScreen } from "./account-screen";

export async function generateMetadata({ params }: PageProps<"/accounts/[id]">): Promise<Metadata> {
  const ctx = await requireSession();
  const account = await getAccount(ctx, (await params).id);
  return { title: account?.name ?? (await getTranslations("accounts"))("title") };
}

/**
 * An account's page reads everything it shows from `/api/v1` (rewrite plan R3). One read stays
 * here: whether the account exists, so that an account that does not answers HTTP 404, which only
 * the server can say (`getAccount` finds an archived account too: its page offers «Restore account»).
 */
export default async function AccountDetailPage({ params }: PageProps<"/accounts/[id]">) {
  const ctx = await requireSession();
  const { id } = await params;
  if (!(await getAccount(ctx, id))) notFound();
  return <AccountScreen id={id} />;
}
