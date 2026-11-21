// What the parts of a service's Activity share (§3.5): the answer of `GET /investments/{accountId}/activity`
// for the period and the filters of the address, and the links that change one filter and keep the rest.
import type { RouteOutput } from "@ledgerly/api-client";
import type { investments } from "@ledgerly/api-contract/investments";
import { type Params, withParams } from "@ledgerly/ui/url";
import type { ServicePage } from "../service/service-view";

type Activity = RouteOutput<typeof investments.getInvestmentActivity>;
export type Events = Extract<Activity, { source: "events" }>;
export type Movements = Extract<Activity, { source: "movements" }>;
export type EventRow = Events["rows"][number];

const FAMILIES = ["trades", "flows", "income", "fees", "other"] as const;
type Family = (typeof FAMILIES)[number];

export interface Filters {
  family: Family | null;
  q: string | null;
  /** The asset of the address, when the service has it (its name for the badge). */
  asset: { id: string; name: string } | null;
  page: number;
}

/** The filters of the address; an asset the service does not have is no filter. */
export function filtersOf(page: ServicePage): Filters {
  const { search, overview } = page;
  const wanted = search.get("asset");
  const asset = overview.service.assets.find((one) => one.id === wanted) ?? null;
  return {
    family: FAMILIES.find((key) => key === search.get("type")) ?? null,
    q: search.get("q")?.trim() || null,
    asset: asset && { id: asset.id, name: asset.name },
    page: Number(search.get("p") ?? "1") || 1,
  };
}

/** Every parameter of the tab as it stands. */
export function currentOf(page: ServicePage, filters: Filters): Params {
  return {
    ...page.section.params,
    type: filters.family ?? undefined,
    q: filters.q ?? undefined,
    asset: filters.asset?.id,
  };
}

/** A link that changes some parameters of the tab, keeps the rest, and starts on the first page. */
export const activityHref = (page: ServicePage, filters: Filters) => (changes: Params) =>
  withParams(`/investments/${page.id}/activity`, currentOf(page, filters), { p: undefined, ...changes });

export { FAMILIES };
