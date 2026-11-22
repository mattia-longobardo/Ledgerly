import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { pockets as pocketRoutes } from "@ledgerly/api-contract/pockets";
import { apiRead } from "@/platform/api-read";
import { PocketScreen } from "./pocket-screen";

/**
 * The name of an open pocket, or 404: the title and the status of the answer, which only the server
 * can give before the page is drawn. It asks `/api/v1` (`apiRead`); `cache` shares the read between
 * the title and the page. Everything the page shows comes from the screen.
 */
const nameOf = cache(async (id: string): Promise<string> => {
  const page = await apiRead(pocketRoutes.getPocket, { params: { id } });
  if (!page) notFound();
  return page.pocket.name;
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
