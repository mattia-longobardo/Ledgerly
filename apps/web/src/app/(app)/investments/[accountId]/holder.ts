import "server-only";
import { cache } from "react";
import { INVESTMENTS } from "@ledgerly/api-contract";
import { views } from "@ledgerly/api-contract/accounts";
import { apiRead } from "@/platform/api-read";
import { accountOf } from "../../accounts/account-read";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** What an account's page of Investments shows: a service, a pension fund (R5b, B1b), or nothing. */
type Holder = { kind: "service"; name: string } | { kind: "fund"; fundId: string; name: string };

/**
 * What holds an account of the person, or null for none — the 404 and the title of the page, which
 * only the server can give before the page is drawn. It asks `/api/v1` (`apiRead`): the account and
 * its context, and the list of the funds only for an account that is no service. `cache` shares the
 * reads between the layout, the title and the page of one request.
 */
export const holderOf = cache(async (accountId: string): Promise<Holder | null> => {
  if (!UUID.test(accountId)) return null;
  const [context, account] = await Promise.all([
    apiRead(views.getAccountContext, { params: { id: accountId } }),
    accountOf(accountId),
  ]);
  if (!context || !account) return null;
  if (context.inInvestments) return { kind: "service", name: account.name };
  const list = await apiRead(INVESTMENTS.funds.listFunds, {});
  const fund = list?.funds.find((one) => one.accountId === accountId);
  return fund ? { kind: "fund", fundId: fund.id, name: fund.name } : null;
});
