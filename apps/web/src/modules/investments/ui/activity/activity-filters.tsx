"use client";

// The filters of a service's Activity (§3.5): a chip per family with its count, the search, and the
// asset the address names. Links: the back button walks them.
import { useTranslations } from "next-intl";
import { Badge } from "@ledgerly/ui/badge";
import { Button } from "@ledgerly/ui/button";
import { cn } from "@ledgerly/ui/cn";
import { Input } from "@ledgerly/ui/input";
import { Link } from "@ledgerly/ui/router";
import type { ServicePage } from "../service/service-view";
import { activityHref, currentOf, type Events, FAMILIES, type Filters } from "./activity-view";

function FamilyChips({
  events,
  filters,
  href,
}: {
  events: Events;
  filters: Filters;
  href: ReturnType<typeof activityHref>;
}) {
  const text = useTranslations("investments");
  const chips = [
    "all" as const,
    ...FAMILIES.filter((key) => events.counts[key] > 0 || key === filters.family),
  ];
  return (
    <nav aria-label={text("activityTab.chips")} className="flex flex-wrap gap-1.5">
      {chips.map((key) => {
        const active = (filters.family ?? "all") === key;
        return (
          <Link
            key={key}
            href={href({ type: key === "all" ? undefined : key })}
            aria-current={active ? "true" : undefined}
            data-testid="activity-chip"
            className={cn(
              "focus-ring inline-flex min-h-7 items-center rounded-full border px-3 text-sm font-medium",
              active ? "border-fg bg-fg text-bg" : "border-border text-muted hover:text-fg",
            )}
          >
            {text("activityTab.chip", {
              label: text(`activityTab.families.${key}`),
              count: String(events.counts[key]),
            })}
          </Link>
        );
      })}
    </nav>
  );
}

/** The search: a form of the address, the other filters kept in it. */
function SearchForm({ page, filters }: { page: ServicePage; filters: Filters }) {
  const text = useTranslations("investments");
  const kept = Object.entries({ ...currentOf(page, filters), q: undefined });
  return (
    <form action={`/investments/${page.id}/activity`} className="flex items-center gap-2" role="search">
      {kept.map(([key, value]) =>
        value === undefined ? null : <input key={key} type="hidden" name={key} value={value} />,
      )}
      <Input
        name="q"
        type="search"
        defaultValue={filters.q ?? ""}
        aria-label={text("activityTab.search")}
        placeholder={text("activityTab.search")}
        className="w-56 max-md:w-full"
      />
      <Button type="submit" size="sm">
        {text("activityTab.searchSubmit")}
      </Button>
    </form>
  );
}

export function ActivityFilters({
  page,
  events,
  filters,
}: {
  page: ServicePage;
  events: Events;
  filters: Filters;
}) {
  const text = useTranslations("investments");
  const href = activityHref(page, filters);
  return (
    <div className="flex flex-col gap-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <FamilyChips events={events} filters={filters} href={href} />
        <SearchForm page={page} filters={filters} />
      </div>
      {filters.asset !== null && (
        <p className="flex flex-wrap items-center gap-2 text-sm">
          <Badge tone="accent">{text("activityTab.asset", { name: filters.asset.name })}</Badge>
          <Link
            href={href({ asset: undefined })}
            className="focus-ring inline-flex min-h-6 items-center rounded-sm text-accent hover:underline"
          >
            {text("activityTab.assetAll")}
          </Link>
        </p>
      )}
    </div>
  );
}

/** «1–50 of 120 (340 in all)» and the two arrows. */
export function ActivityPager({
  page,
  events,
  filters,
}: {
  page: ServicePage;
  events: Events;
  filters: Filters;
}) {
  const text = useTranslations("investments");
  const href = activityHref(page, filters);
  const pageLink =
    "focus-ring inline-grid size-7 place-items-center rounded-ctl border border-border bg-card hover:bg-hover";
  const arrow = (target: number | null, label: string, sign: string) =>
    target === null ? (
      <button type="button" disabled aria-label={label} className={cn(pageLink, "text-faint")}>
        {sign}
      </button>
    ) : (
      <Link
        href={href({ p: target === 1 ? undefined : String(target) })}
        aria-label={label}
        className={pageLink}
      >
        {sign}
      </Link>
    );
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-2.5 text-sm">
      <span data-testid="activity-range" className="text-muted tabular-nums">
        {text("activityTab.range", {
          first: String(events.first),
          last: String(events.last),
          total: String(events.total),
          allTime: String(events.allTime),
        })}
      </span>
      <span className="flex items-center gap-1.5">
        {arrow(events.page > 1 ? events.page - 1 : null, text("activityTab.previous"), "‹")}
        {arrow(events.page < events.pages ? events.page + 1 : null, text("activityTab.next"), "›")}
      </span>
    </div>
  );
}
