"use client";

// Time off › Settings (PERS-158), read from `/api/v1` (rewrite plan R3): everything that only leave
// depends on — the types of leave and what a year grants of each (R5g), the working week, how long a
// working day is, the holidays and the days off, and the way to the external calendar. The values keep their own routes; its connection is on its own page of
// Settings › Integrations.
import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { profile } from "@ledgerly/api-contract/settings";
import { holidays, timeoff, types } from "@ledgerly/api-contract/timeoff";
import type { RouteOutput } from "@ledgerly/api-client";
import { civilDateIn, today } from "@ledgerly/format/dates";
import { formatDate } from "@ledgerly/format/format";
import { ButtonLink } from "@ledgerly/ui/button";
import { useApi } from "@ledgerly/ui/data";
import { Loaded } from "@ledgerly/ui/loaded";
import { SettingsGrid, SettingsSection } from "@ledgerly/ui/section";
import { Page } from "@ledgerly/ui/shell/page";
import { TabLinks } from "@ledgerly/ui/tab-links";
import { ActivateButton } from "../../settings/plugins/activate-button";
import { UnsavedChangesProvider } from "@ledgerly/ui/unsaved-changes";
import { parseYearQuery } from "@ledgerly/ui/period";
import { YearPicker } from "@ledgerly/ui/year-picker";
import TimeOffLoading from "../loading";
import { type CalendarRow, HolidayCalendars } from "./holiday-calendars";
import { LeaveTypes } from "./leave-types";
import { RestDays } from "./rest-days";
import { WorkingHoursForm } from "./settings-forms";
import { type TypeAllowance, TypeAllowanceForm } from "./type-allowances";
import { WorkWeekForm } from "./work-week";

type Year = RouteOutput<typeof timeoff.getTimeOff>;
type Preferences = RouteOutput<typeof profile.getPreferences>;
type Calendar = RouteOutput<typeof holidays.listHolidayCalendars>["calendars"][number];

/** A stated number of days as a person would type it back. */
const typed = (days: number | null | undefined) => (days === null || days === undefined ? "" : String(days));

/** The allowance of each type with one, of a year: what the form starts from. */
function allowancesOf(year: Pick<Year, "allowances">, counted: Year["types"]): TypeAllowance[] {
  return counted.map((type) => {
    const stated = year.allowances.find((one) => one.typeId === type.id);
    return {
      typeId: type.id,
      name: type.name,
      days: typed(stated?.days),
      carriedDays: typed(stated?.carriedDays),
    };
  });
}

function rowOf(calendar: Calendar, where: Pick<Preferences, "timeZone" | "locale">): CalendarRow {
  return {
    id: calendar.id,
    label: calendar.label,
    source: calendar.source,
    country: calendar.country,
    subdivision: calendar.subdivision,
    lastSynced:
      calendar.lastSyncedAt === null
        ? null
        : formatDate(civilDateIn(new Date(calendar.lastSyncedAt), where.timeZone), "long", where.locale),
    lastError: calendar.lastError,
    days: calendar.days,
  };
}

/** The year of the allowance, from the URL: up to next year, which can be stated ahead of time. */
interface Place {
  year: number;
  currentYear: number;
}

const hrefFor = (year: number) => `/timeoff/settings?year=${year}`;

export function TimeOffSettingsScreen({ calendarLink }: { calendarLink: CalendarLink | null }) {
  const asked = useSearchParams().get("year");
  const prefs = useApi(profile.getPreferences, {});
  if (prefs.data === undefined && !prefs.error) return <TimeOffLoading />;
  return (
    <Loaded state={prefs}>
      {(preferences) => {
        const currentYear = Number(today(preferences.timeZone).slice(0, 4));
        const place = { year: parseYearQuery(asked, currentYear, currentYear + 1), currentYear };
        return <SettingsPage place={place} preferences={preferences} calendarLink={calendarLink} />;
      }}
    </Loaded>
  );
}

function SettingsPage({
  place,
  preferences,
  calendarLink,
}: {
  place: Place;
  preferences: Preferences;
  calendarLink: CalendarLink | null;
}) {
  const text = useTranslations("timeoff");
  const leaveTypes = useApi(types.listLeaveTypes, {});
  return (
    <Page title={text("tabs.settings")} parent={{ href: "/timeoff", label: text("title") }}>
      <div className="flex flex-col gap-4">
        <h1 className="text-title font-semibold tracking-title">{text("heading")}</h1>
        <TabLinks
          label={text("tabs.label")}
          tabs={[
            { href: `/timeoff?year=${place.year}`, label: text("tabs.overview"), active: false },
            { href: hrefFor(place.year), label: text("tabs.settings"), active: true },
          ]}
        />
      </div>
      {/* Save and Discard for the forms below live in the banner, which appears with a change. */}
      <UnsavedChangesProvider>
        <SettingsGrid>
          <SettingsSection
            title={text("settings.types.title")}
            description={text("settings.types.description")}
          >
            <Loaded state={leaveTypes}>{(list) => <LeaveTypes types={list.types} />}</Loaded>
          </SettingsSection>
          <SettingsSection
            title={text("settings.allowance.title")}
            description={text("settings.allowance.description")}
          >
            <AllowanceSection place={place} />
          </SettingsSection>
          <WeekSection weekStart={preferences.weekStart} />
          <SettingsSection
            title={text("settings.hours.title")}
            description={text("settings.hours.description")}
          >
            <WorkingHoursForm minutesPerDay={preferences.minutesPerDay} />
          </SettingsSection>
          <HolidaysSection place={place} preferences={preferences} />
          {calendarLink && <CalendarLinkSection link={calendarLink} />}
        </SettingsGrid>
      </UnsavedChangesProvider>
    </Page>
  );
}

function WeekSection({ weekStart }: { weekStart: number }) {
  const text = useTranslations("timeoff");
  const week = useApi(types.getLeaveSettings, {});
  return (
    <SettingsSection title={text("settings.week.title")} description={text("settings.week.description")}>
      <Loaded state={week}>
        {(stated) => (
          <WorkWeekForm
            workDays={stated.workDays}
            yearStartMonth={stated.yearStartMonth}
            weekStart={weekStart}
          />
        )}
      </Loaded>
    </SettingsSection>
  );
}

/** The calendars of public holidays, and the person's own days off of the year beside them. */
function HolidaysSection({ place, preferences }: { place: Place; preferences: Preferences }) {
  const text = useTranslations("timeoff");
  const settings = useTranslations("settings");
  const restDays = useApi(types.listRestDays, {});
  const calendars = useApi(holidays.listHolidayCalendars, {});
  return (
    <SettingsSection title={settings("holidays.title")} description={settings("holidays.description")}>
      <div className="flex flex-col gap-3">
        <Loaded state={calendars}>
          {(kept) => (
            <>
              {/* Without a calendar only the working week is known: a holiday reads as a working day. */}
              {kept.calendars.length === 0 && (
                <p className="text-sm text-warn" data-testid="no-holiday-calendar">
                  {text("settings.noCalendar")}
                </p>
              )}
              <HolidayCalendars
                calendars={kept.calendars.map((one) => rowOf(one, preferences))}
                year={place.currentYear}
              />
            </>
          )}
        </Loaded>
        <Loaded state={restDays}>{(stated) => <RestDays days={stated.days} />}</Loaded>
      </div>
    </SettingsSection>
  );
}

/**
 * What the year grants of each type with an allowance. The stepper changes the year through the URL;
 * the form is keyed by the year, so a value typed for one year is never saved under another.
 */
function AllowanceSection({ place }: { place: Place }) {
  const text = useTranslations("timeoff");
  const { year } = place;
  const shown = useApi(timeoff.getTimeOff, { params: { year: String(year) } });
  const before = useApi(timeoff.getTimeOff, { params: { year: String(year - 1) } });
  return (
    <Loaded state={shown}>
      {(view) => {
        const counted = view.types.filter((type) => type.hasAllowance);
        if (counted.length === 0) return <p className="text-muted">{text("settings.allowance.none")}</p>;
        const previous = before.data?.allowances.some((one) => one.days !== null)
          ? allowancesOf(before.data, counted)
          : null;
        return (
          <div className="@container">
            <TypeAllowanceForm
              // Another year, or another list of types, is another form.
              key={`${year} ${counted.map((one) => one.id).join(" ")}`}
              year={year}
              rows={allowancesOf(view, counted)}
              previous={previous}
              stepper={<AllowanceYears place={place} years={view.years} />}
            />
          </div>
        );
      }}
    </Loaded>
  );
}

function AllowanceYears({ place, years }: { place: Place; years: number[] }) {
  const text = useTranslations("timeoff");
  return (
    <YearPicker
      year={place.year}
      years={years}
      currentYear={place.currentYear}
      lastYear={place.currentYear + 1}
      hrefFor={hrefFor}
      labels={{
        label: text("header.yearLabel"),
        previous: text("header.previousYear"),
        next: text("header.nextYear"),
        today: text("header.thisYear"),
      }}
    />
  );
}

/** The external calendar: its name, its page and its state, which only the server knows (H56). */
interface CalendarLink {
  id: string;
  name: string;
  href: string;
  state: "not_active" | "not_connected" | "connected" | "disconnected" | "needs_cleanup";
  /** The word of its state, already translated. */
  word: string;
}

/**
 * The external calendar (plugin-settings.md §2.2, PERS-615 §4): its state in a word and the step it
 * needs — «Activate» when it is off, «Clean up» when it is off with days that wait for it, else the
 * way to its page, where its connection is.
 */
function CalendarLinkSection({ link }: { link: CalendarLink }) {
  const settings = useTranslations("settings");
  const provider = link.name;
  let description = settings("plugin.movedHint", { provider });
  let action = (
    <ButtonLink href={link.href} size="sm">
      {settings("plugin.settingsOf", { provider })}
    </ButtonLink>
  );
  if (link.state === "not_active") {
    description = settings("plugin.calendar.notActive", { provider });
    action = (
      <ActivateButton
        pluginId={link.id}
        provider={provider}
        label={settings("plugins.actions.activate")}
        variant="secondary"
      />
    );
  } else if (link.state === "needs_cleanup") {
    description = settings("plugin.calendar.needsCleanup", { provider });
    action = (
      <ButtonLink href={link.href} size="sm" variant="primary">
        {settings("plugins.actions.fix")}
      </ButtonLink>
    );
  }
  return (
    <SettingsSection
      title={provider}
      description={description}
      action={
        <div className="flex flex-col gap-2" data-testid="calendar-plugin" data-state={link.state}>
          <span className="text-sm font-medium">{link.word}</span>
          {action}
        </div>
      }
    />
  );
}
