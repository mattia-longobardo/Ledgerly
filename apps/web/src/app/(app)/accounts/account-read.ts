import "server-only";
import { cache } from "react";
import { accounts as accountRoutes } from "@ledgerly/api-contract/accounts";
import { apiRead } from "@/platform/api-read";

/**
 * An account of the person (an archived one too), or null: the 404 and the title of a page about one
 * account, which only the server can give before the page is drawn. It asks `/api/v1` (`apiRead`);
 * `cache` shares the read between the title and the page of one request.
 */
export const accountOf = cache((id: string) => apiRead(accountRoutes.getAccount, { params: { id } }));
