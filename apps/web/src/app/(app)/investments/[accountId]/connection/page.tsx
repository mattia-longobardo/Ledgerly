import { notFound } from "next/navigation";
import { ServiceScreen } from "@/modules/investments/client";
import { holderOf } from "../holder";

/**
 * A service's Connection, or Settings for a manual one (docs/design/investments-ux.md §3.6). The page
 * reads no data (rewrite plan R3): the screen reads `GET /investments/{accountId}/connection`.
 */
export default async function InvestmentServiceConnection({
  params,
}: PageProps<"/investments/[accountId]/connection">) {
  const { accountId } = await params;
  // A fund has its four tabs on its page: the tabs of a service are not its own (R5b).
  if ((await holderOf(accountId))?.kind !== "service") notFound();
  return <ServiceScreen id={accountId} tab="connection" />;
}

export const dynamic = "force-dynamic";
