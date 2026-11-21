"use client";

// A service's Activity (docs/design/investments-ux.md §3.5): the events of the period of a provider's
// service, fifty a page, filtered by family, text or asset; or a manual one's bank movements. Read from
// `GET /investments/{accountId}/activity`.
import { useTranslations } from "next-intl";
import { investments } from "@ledgerly/api-contract/investments";
import { Card } from "@ledgerly/ui/card";
import { useApi, useLatest } from "@ledgerly/ui/data";
import { Loaded } from "@ledgerly/ui/loaded";
import type { ServicePage } from "../service/service-view";
import { ActivityFilters, ActivityPager } from "./activity-filters";
import { ActivityKpis, TransferProposals } from "./activity-kpis";
import { type Events, type Filters, filtersOf } from "./activity-view";
import { EventsTable } from "./events-table";
import { ManualActivity } from "./manual-activity";

function EventsActivity({ page, events, filters }: { page: ServicePage; events: Events; filters: Filters }) {
  const text = useTranslations("investments");
  const filtered = filters.q !== null || filters.family !== null || filters.asset !== null;
  return (
    <>
      <ActivityKpis page={page} events={events} />
      <TransferProposals page={page} events={events} />
      <Card padded={false} className="min-w-0">
        <ActivityFilters page={page} events={events} filters={filters} />
        {events.rows.length === 0 ? (
          <p className="px-4 pb-4 text-sm text-muted">
            {filtered ? text("activityTab.emptyFiltered") : text("activityTab.empty")}
          </p>
        ) : (
          <EventsTable page={page} events={events} />
        )}
        <ActivityPager page={page} events={events} filters={filters} />
      </Card>
    </>
  );
}

export function ActivityTab({ page }: { page: ServicePage }) {
  const filters = filtersOf(page);
  const read = useLatest(
    useApi(investments.getInvestmentActivity, {
      params: { accountId: page.id },
      query: {
        ...page.section.api,
        family: filters.family ?? undefined,
        q: filters.q ?? undefined,
        assetId: filters.asset?.id,
        page: filters.page,
      },
    }),
  );
  return (
    <Loaded state={read}>
      {(activity) =>
        activity.source === "movements" ? (
          <ManualActivity page={page} movements={activity} />
        ) : (
          <EventsActivity page={page} events={activity} filters={filters} />
        )
      }
    </Loaded>
  );
}
