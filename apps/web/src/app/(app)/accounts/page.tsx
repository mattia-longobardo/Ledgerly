import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { AccountsScreen } from "./accounts-screen";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("accounts"))("title") };
}

/** Accounts reads everything it shows from `/api/v1`. */
export default function AccountsPage() {
  return <AccountsScreen />;
}
