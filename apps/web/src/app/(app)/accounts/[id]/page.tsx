import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getAccount } from "@ledgerly/domain/accounts";
import { syncedServicesOf } from "@ledgerly/domain/investments";
import { groupIban } from "@ledgerly/domain/platform/iban";
import { requireSession } from "@/platform/auth/session";
import { AccountScreen } from "./account-screen";
import { accountConnectionRow } from "./connection-status";

export async function generateMetadata({ params }: PageProps<"/accounts/[id]">): Promise<Metadata> {
  const ctx = await requireSession();
  const account = await getAccount(ctx, (await params).id);
  return { title: account?.name ?? (await getTranslations("accounts"))("title") };
}

/**
 * An account's page reads its figures from `/api/v1` (rewrite plan R3). Two reads stay here: the IBAN,
 * which no answer carries (H45) and whose display Mattia has not decided; and the row of the
 * connection the account comes from, since no answer ties an account to its connection yet.
 */
export default async function AccountDetailPage({ params, searchParams }: PageProps<"/accounts/[id]">) {
  const ctx = await requireSession();
  const { id } = await params;
  // `getAccount` finds an archived account too: its page still offers «Restore account».
  const account = await getAccount(ctx, id);
  if (!account) notFound();
  const settings = (await searchParams).tab === "settings";
  // A service of Investments fed by a provider has its key replaced on its own page.
  const service = (await syncedServicesOf(ctx, [id])).get(id) ?? null;
  const connection = await accountConnectionRow(
    ctx,
    account,
    service !== null ? `/investments/${id}/connection` : null,
    new Date(),
  );
  return (
    <AccountScreen
      id={id}
      iban={settings && account.iban !== null ? groupIban(account.iban) : null}
      connection={connection}
    />
  );
}
