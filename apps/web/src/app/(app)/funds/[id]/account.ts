import "server-only";
import { notFound } from "next/navigation";
import { funds as fundRoutes } from "@ledgerly/api-contract/funds";
import { apiRead } from "@/platform/api-read";

/**
 * The account that holds a fund, or 404 for a fund that is not the person's: where the fund's old
 * address leads (rewrite plan R5b, B1b), which only the server can give. It asks `/api/v1` (`apiRead`).
 */
export async function fundAccountOf(id: string): Promise<string> {
  const settings = await apiRead(fundRoutes.getFundSettings, { params: { id } });
  if (!settings) notFound();
  return settings.fund.accountId;
}
