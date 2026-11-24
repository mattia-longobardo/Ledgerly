"use client";

// The top of the Time off page: the year stepper and «Add leave», the heading with the year's
// allowances, the tabs, and the line that qualifies the figures below them.
import { ButtonLink } from "@ledgerly/ui/button";
import { TabLinks } from "@ledgerly/ui/tab-links";
import { AddLeave } from "./leave-actions";
import { formatNumber, headline, type Say, type View } from "./words";
import { type Filter, yearHref } from "./year";
import { YearPicker } from "@ledgerly/ui/year-picker";

/** The external calendar's own figures for the year: the plugin's, read beside the page until R5c (TOF-4). */
interface ExternalStats {
  totalAvailable: number;
  used: number;
  remaining: number;
}

interface Place {
  year: number;
  currentYear: number;
  filter: Filter;
}

/** What the topbar holds: the year stepper and, where there is room for it, «Add leave». */
export function YearActions({ view, place, say }: { view: View; place: Place; say: Say }) {
  const { text } = say;
  return (
    <div className="flex items-center gap-2">
      <YearPicker
        year={place.year}
        years={view.years}
        currentYear={place.currentYear}
        hrefFor={(one) => yearHref(one, place.filter)}
        labels={{
          label: text("header.yearLabel"),
          previous: text("header.previousYear"),
          next: text("header.nextYear"),
          today: text("header.thisYear"),
        }}
      />
      {/* In the topbar where there is room for it; on a phone it sits under the title. */}
      <AddLeave label={text("actions.add")} className="max-md:hidden" />
    </div>
  );
}

export function YearHeader({
  view,
  place,
  external,
  say,
}: {
  view: View;
  place: Place;
  external: ExternalStats | null;
  say: Say;
}) {
  const { text } = say;
  return (
    <>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div className="flex flex-wrap items-baseline gap-3">
          <h1 className="text-title font-semibold tracking-title">{text("heading")}</h1>
          <p className="text-muted">{headline(say, view) || text("header.noAllowance")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* No type has an allowance stated for the year: the way to state one. */}
          {view.balances.every((one) => one.allowanceMinutes === null) && (
            <ButtonLink href={`/timeoff/settings?year=${place.year}`} size="sm" className="max-md:h-9">
              {text("actions.setAllowance")}
            </ButtonLink>
          )}
          <AddLeave label={text("actions.add")} className="md:hidden" />
        </div>
      </div>
      <TabLinks
        label={text("tabs.label")}
        tabs={[
          { href: yearHref(place.year, place.filter), label: text("tabs.overview"), active: true },
          { href: `/timeoff/settings?year=${place.year}`, label: text("tabs.settings"), active: false },
        ]}
      />
      <Qualifiers external={external} say={say} />
    </>
  );
}

function Qualifiers({ external, say }: { external: ExternalStats | null; say: Say }) {
  const { text, locale } = say;
  return (
    <>
      {/* The external calendar's own figures, beside ours and never folded into them: it honours a
        leave-year window (calendar, fiscal or anniversary) this app does not model (plan F7 §3.6.4). */}
      {external !== null && (
        <p className="-mt-2 text-sm text-faint tabular-nums">
          {text("externalCheck", {
            total: formatNumber(external.totalAvailable, locale),
            used: formatNumber(external.used, locale),
            remaining: formatNumber(external.remaining, locale),
          })}
        </p>
      )}
    </>
  );
}
