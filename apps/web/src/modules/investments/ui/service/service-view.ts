// What a service's tabs share (rewrite plan R3): the answer of `GET /investments/{accountId}` for the
// period of the address, the person's way of writing figures, and the address's links.
import type { RouteOutput } from "@ledgerly/api-client";
import type { investments } from "@ledgerly/api-contract/investments";
import type { SectionQuery } from "@ledgerly/ui/period";
import { type Params, withParams } from "@ledgerly/ui/url";
import type { Say } from "@/platform/say";
import type { ServiceContext } from "../dialog-kit";
import { type Money, moneyIn, type Percent, percentIn } from "../present";
import { type ServiceTabKey, tabPath } from "./service-tabs";

type Overview = RouteOutput<typeof investments.getInvestment>;

export interface ServicePage {
  id: string;
  tab: ServiceTabKey;
  say: Say;
  section: SectionQuery;
  /** The address's parameters of the tab (filters, page, view), the period's apart. */
  search: URLSearchParams;
  overview: Overview;
  /** The period in words. */
  name: string;
  /** Amounts in the service's own currency, and in the display one. */
  money: Money;
  display: Money;
  percent: Percent;
  /** A tab's link, with the period and `extra`. */
  href: (tab: ServiceTabKey, extra?: Params) => string;
  context: ServiceContext;
}

export function servicePage(
  input: Pick<ServicePage, "id" | "tab" | "say" | "section" | "search" | "overview" | "name">,
): ServicePage {
  const { say, overview, id } = input;
  const { service } = overview;
  return {
    ...input,
    money: moneyIn(say, service.currency),
    display: moneyIn(say, overview.currency),
    percent: percentIn(say),
    href: (tab, extra = {}) => withParams(tabPath(id, tab), {}, { ...input.section.params, ...extra }),
    context: {
      accountId: id,
      name: service.name,
      currency: service.currency,
      numberFormat: say.format,
      locale: say.locale,
      today: say.todayOn,
      mode: service.mode,
      synced: service.origin === "synced",
      valueEditable: service.valueEditable,
    },
  };
}
