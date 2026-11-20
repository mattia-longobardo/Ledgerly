import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { pocketBalances } from "@ledgerly/domain/pockets";
import { requireSession } from "@/platform/auth/session";
import { PocketScreen } from "./pocket-screen";

/**
 * The name of an open pocket, or 404: the title and the status of the answer, which only a server read
 * can give before the page is drawn. M10: a necessary server read, as on an account's and a budget's
 * page (decision A); everything the page shows comes from `/api/v1`. `pocketBalances` reads the
 * ledger only, not the page's view; `cache` shares it between the title and the page.
 */
const nameOf = cache(async (id: string): Promise<string> => {
  const ctx = await requireSession();
  const open = (await pocketBalances(ctx)).find((row) => row.pocket.id === id);
  if (!open) notFound();
  return open.pocket.name;
});

export async function generateMetadata({ params }: PageProps<"/pockets/[id]">): Promise<Metadata> {
  return { title: await nameOf((await params).id) };
}

/** One pocket (spec §7.4): what is left, what was spent from it and what is planned, from `/api/v1`. */
export default async function PocketPage({ params }: PageProps<"/pockets/[id]">) {
  const { id } = await params;
  await nameOf(id);
  return <PocketScreen id={id} />;
}
