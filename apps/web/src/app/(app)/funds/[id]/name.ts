import "server-only";
import { notFound } from "next/navigation";
import { cache } from "react";
import { funds as fundRoutes } from "@ledgerly/api-contract/funds";
import { apiRead } from "@/platform/api-read";

/**
 * A fund's name, or 404 for a fund that is not the person's: the title and the status of the answer,
 * which only the server can give before the page is drawn. It asks `/api/v1` (`apiRead`); `cache`
 * shares the read between the layout and the title.
 */
export const fundNameOf = cache(async (id: string): Promise<string> => {
  const settings = await apiRead(fundRoutes.getFundSettings, { params: { id } });
  if (!settings) notFound();
  return settings.fund.name;
});
