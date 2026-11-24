"use client";

// Time off (spec §7.9), read from `/api/v1` (rewrite plan R3): the year's allowance, what is left of
// it and where that number comes from, the twelve months as bars and as calendars, and every day
// behind them. Every figure is a field of `GET /timeoff/{year}`; the screen turns minutes into days
// and formats them. The year and the filter are in the URL: a year worth looking at is a year worth
// linking to.
import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { useMemo } from "react";
import { profile } from "@ledgerly/api-contract/settings";
import { timeoff } from "@ledgerly/api-contract/timeoff";
import { today } from "@ledgerly/format/dates";
import { type ApiState, useApi, useLatest } from "@ledgerly/ui/data";
import { ButtonLink } from "@ledgerly/ui/button";
import { Loaded } from "@ledgerly/ui/loaded";
import { Page } from "@ledgerly/ui/shell/page";
import { EmptyState } from "@ledgerly/ui/states";
import {
  AddLeave,
  bookedOf,
  CalendarCard,
  type Filter,
  filterOf,
  LeaveBoard,
  LeaveTable,
  type Say,
  type View,
  YearActions,
  YearAlerts,
  YearCards,
  YearHeader,
} from "@/modules/timeoff/client";
import { parseYearQuery } from "@ledgerly/ui/period";
import TimeOffLoading from "./loading";

/** Nothing to draw yet: the skeleton the route shows while it loads. A refusal is `Loaded`'s. */
const waiting = (state: ApiState<unknown>) => state.data === undefined && !state.error;

interface Place {
  year: number;
  currentYear: number;
  filter: Filter;
}

/** The year in the URL, once the person's day is known. */
export function TimeOffScreen() {
  const query = useSearchParams();
  const prefs = useApi(profile.getPreferences, {});
  if (waiting(prefs)) return <TimeOffLoading />;
  return (
    <Loaded state={prefs}>
      {(preferences) => {
        const currentYear = Number(today(preferences.timeZone).slice(0, 4));
        const place = {
          year: parseYearQuery(query.get("year"), currentYear, 2200),
          currentYear,
          filter: filterOf(query.get("filter")),
        };
        return <TimeOffYear place={place} locale={preferences.locale} />;
      }}
    </Loaded>
  );
}

function TimeOffYear({ place, locale }: { place: Place; locale: Say["locale"] }) {
  const text = useTranslations("timeoff");
  const read = useLatest(useApi(timeoff.getTimeOff, { params: { year: String(place.year) } }));
  const rows = read.data?.rows;
  // One list per answer: the board keeps what a write showed until a new answer arrives.
  const booked = useMemo(() => bookedOf(rows ?? []), [rows]);
  if (waiting(read)) return <TimeOffLoading />;
  return (
    <Loaded state={read}>
      {(view) =>
        // Leave is booked under a type of the person's: with none, the way to add one.
        view.types.length === 0 ? (
          <NoTypes year={place.year} />
        ) : (
          <LeaveBoard
            year={place.year}
            today={view.today}
            minutesPerDay={view.minutesPerDay}
            weekStart={view.weekStart}
            countedThrough={view.countedThrough}
            days={booked}
            holidays={view.holidays}
            workDays={view.workDays}
            yearStartMonth={view.yearStartMonth}
            window={view.window}
            residuals={Object.fromEntries(view.balances.map((one) => [one.typeId, one.residualInput]))}
            forecasts={Object.fromEntries(view.balances.map((one) => [one.typeId, one.forecastInput]))}
            types={view.types}
          >
            <YearPage view={view} place={place} say={{ text, locale, minutesPerDay: view.minutesPerDay }} />
          </LeaveBoard>
        )
      }
    </Loaded>
  );
}

function NoTypes({ year }: { year: number }) {
  const text = useTranslations("timeoff");
  return (
    <Page title={text("title")}>
      <EmptyState
        title={text("noTypes.title")}
        description={text("noTypes.description")}
        actions={<ButtonLink href={`/timeoff/settings?year=${year}`}>{text("noTypes.action")}</ButtonLink>}
      />
    </Page>
  );
}

function YearPage({ view, place, say }: { view: View; place: Place; say: Say }) {
  const { text } = say;
  return (
    <Page title={text("title")} actions={<YearActions view={view} place={place} say={say} />}>
      {/* The external calendar's own figures of the year: null without one, or without its pass. */}
      <YearHeader view={view} place={place} external={view.external} say={say} />
      <YearAlerts view={view} say={say} />
      <YearCards view={view} year={place.year} say={say} />
      <CalendarCard view={view} year={place.year} currentYear={place.currentYear} say={say} />
      <LeaveTable view={view} year={place.year} filter={place.filter} say={say} />
      {view.rows.length === 0 && (
        <EmptyState
          title={text("empty.title")}
          description={text("empty.description")}
          actions={<AddLeave label={text("actions.add")} />}
        />
      )}
    </Page>
  );
}
