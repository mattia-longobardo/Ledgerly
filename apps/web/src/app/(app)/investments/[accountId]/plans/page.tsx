import { HolderScreen } from "../holder-screen";

/**
 * The purchase plans of a manual portfolio (rewrite plan R5d, step 2; 11-standardization.md §11.3). The
 * page reads no data: the screen reads `GET /investments/{accountId}/plans`.
 */
export default async function InvestmentServicePlans({
  params,
}: PageProps<"/investments/[accountId]/plans">) {
  const { accountId } = await params;
  return <HolderScreen accountId={accountId} tab="plans" />;
}

export const dynamic = "force-dynamic";
