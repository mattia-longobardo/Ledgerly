import { notFound, permanentRedirect } from "next/navigation";
import { isFundId } from "@ledgerly/domain/funds/client";
import { withParams } from "@ledgerly/ui/url";
import { appRoute } from "@/platform/route";
import { fundAccountOf } from "./account";

/**
 * A fund's old address (rewrite plan R5b, B1b): the fund's page is its account's in Investments. The
 * query goes along, and the page there answers the redirects of its old forms; another person's fund
 * answers a real 404.
 */
export default async function FundDetailPage({ params, searchParams }: PageProps<"/funds/[id]">) {
  const { id } = await params;
  if (!isFundId(id)) notFound();
  const accountId = await fundAccountOf(id);
  const query = Object.entries(await searchParams).flatMap(([key, value]) =>
    typeof value === "string" ? [[key, value] as const] : [],
  );
  permanentRedirect(appRoute(withParams(`/investments/${accountId}`, {}, Object.fromEntries(query))));
}
