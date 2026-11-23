import { HolderScreen } from "../holder-screen";

/**
 * A service's Connection, or Settings for a manual one (docs/design/investments-ux.md §3.6). The page
 * reads no data (rewrite plan R3): the screen reads `GET /investments/{accountId}/connection`.
 */
export default async function InvestmentServiceConnection({
  params,
}: PageProps<"/investments/[accountId]/connection">) {
  const { accountId } = await params;
  return <HolderScreen accountId={accountId} tab="connection" />;
}

export const dynamic = "force-dynamic";
