import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { accountOf } from "../account-read";
import { AccountScreen } from "./account-screen";

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
