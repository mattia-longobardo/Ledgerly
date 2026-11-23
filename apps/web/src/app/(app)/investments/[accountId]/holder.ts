import "server-only";
import { cache } from "react";
import { views } from "@ledgerly/api-contract/accounts";
import { apiRead } from "@/platform/api-read";
import { accountOf } from "../../accounts/account-read";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** What an account's page of Investments shows: a service, a pension fund (R5b, B1b), or nothing. */
export type Holder = { kind: "service"; name: string } | { kind: "fund"; fundId: string; name: string };

/**
 * What holds an account of the person, or null for none — the 404 and the title of the page, which
 * only the server can give before the page is drawn. It asks `/api/v1` (`apiRead`): the account, which
 * names the fund whose value it holds (`fundId`, R5b), then the account's context for any other. A
 * prefetch of a tab or a period runs it again, so it reads no more.
 * `cache` shares the reads between the layout, the title and the page of one request.
 */
export const holderOf = cache(async (accountId: string): Promise<Holder | null> => {
  if (!UUID.test(accountId)) return null;
  const account = await accountOf(accountId);
  if (!account) return null;
  // The fund's account is named after it at creation: its name is the page's title.
  if (account.fundId) return { kind: "fund", fundId: account.fundId, name: account.name };
  if (account.type === "pension") return null;
  const context = await apiRead(views.getAccountContext, { params: { id: accountId } });
  return context?.inInvestments ? { kind: "service", name: account.name } : null;
});
