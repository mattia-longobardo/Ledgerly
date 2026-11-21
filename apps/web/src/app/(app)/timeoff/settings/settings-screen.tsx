"use client";

// Time off › Settings (PERS-158), read from `/api/v1` (rewrite plan R3): everything that only leave
// depends on — the year's allowance, how long a working day is, the holidays, and the way to the
// external calendar. The values keep their own routes; its connection is on its own page of
// Settings › Integrations.
import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { profile } from "@ledgerly/api-contract/settings";
import { holidays, timeoff } from "@ledgerly/api-contract/timeoff";
import type { RouteOutput } from "@ledgerly/api-client";
import { civilDateIn, today } from "@ledgerly/format/dates";
import { formatDate } from "@ledgerly/format/format";
import { ButtonLink } from "@ledgerly/ui/button";
import { type ApiState, useApi } from "@ledgerly/ui/data";
import { Loaded } from "@ledgerly/ui/loaded";
import { SettingsGrid, SettingsSection } from "@ledgerly/ui/section";
import { Page } from "@ledgerly/ui/shell/page";
import { TabLinks } from "@ledgerly/ui/tab-links";
import { UnsavedChangesProvider } from "@ledgerly/ui/unsaved-changes";
import { parseYearQuery } from "@ledgerly/ui/period";
import { YearPicker } from "@ledgerly/ui/year-picker";
import TimeOffLoading from "../loading";
import { type CalendarRow, HolidayCalendars } from "./holiday-calendars";
import { type AllowanceSummary, AllowanceForm, PatronSaintForm, WorkingHoursForm } from "./settings-forms";

type Allowance = RouteOutput<typeof timeoff.listTimeOffAllowances>["allowances"][number];
type Preferences = RouteOutput<typeof profile.getPreferences>;
type Calendar = RouteOutput<typeof holidays.listHolidayCalendars>["calendars"][number];

/** A stated number of days as a person would type it back. */
const typed = (days: number | null) => (days === null ? "" : String(days));

function summary(year: number, allowance: Allowance | undefined): AllowanceSummary {
  return {
    year,
    vacationDays: typed(allowance?.vacationDays ?? null),
    rolDays: typed(allowance?.rolDays ?? null),
    totalDays: typed(allowance?.totalDays ?? null),
    note: allowance?.note ?? "",
  };
}

const statedFor = (stated: Allowance[], year: number) => stated.find((one) => one.year === year);

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

export function TimeOffSettingsScreen({ calendarLink }: { calendarLink: CalendarLink }) {
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
  calendarLink: CalendarLink;
}) {
  const text = useTranslations("timeoff");
  const settings = useTranslations("settings");
  const allowances = useApi(timeoff.listTimeOffAllowances, {});
  const calendars = useApi(holidays.listHolidayCalendars, {});
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
            title={text("settings.allowance.title")}
            description={text("allowance.description")}
          >
            <AllowanceSection place={place} allowances={allowances} />
          </SettingsSection>
          <SettingsSection
            title={text("settings.hours.title")}
            description={text("settings.hours.description")}
          >
            <WorkingHoursForm minutesPerDay={preferences.minutesPerDay} />
          </SettingsSection>
          <SettingsSection title={settings("holidays.title")} description={settings("holidays.description")}>
            <div className="flex flex-col gap-3">
              <Loaded state={calendars}>
                {(kept) => (
                  <HolidayCalendars
                    calendars={kept.calendars.map((one) => rowOf(one, preferences))}
                    year={place.currentYear}
                  />
                )}
              </Loaded>
              <PatronSaintForm patronSaint={preferences.patronSaint} />
            </div>
          </SettingsSection>
          <CalendarLinkSection link={calendarLink} />
        </SettingsGrid>
      </UnsavedChangesProvider>
    </Page>
  );
}

/**
 * The year's allowance. The stepper changes the year through the URL; the form is keyed by the
 * year, so a value typed for one year is never saved under another.
 */
function AllowanceSection({
  place,
  allowances,
}: {
  place: Place;
  allowances: ApiState<{ allowances: Allowance[] }>;
}) {
  const text = useTranslations("timeoff");
  const { year, currentYear } = place;
  return (
    <Loaded state={allowances}>
      {({ allowances: stated }) => {
        const previous = statedFor(stated, year - 1);
        return (
          <div className="@container">
            <AllowanceForm
              key={year}
              allowance={summary(year, statedFor(stated, year))}
              previous={previous ? summary(year - 1, previous) : null}
              stepper={
                <YearPicker
                  year={year}
                  years={stated.map((one) => one.year)}
                  currentYear={currentYear}
                  lastYear={currentYear + 1}
                  hrefFor={hrefFor}
                  labels={{
                    label: text("header.yearLabel"),
                    previous: text("header.previousYear"),
                    next: text("header.nextYear"),
                    today: text("header.thisYear"),
                  }}
                />
              }
            />
          </div>
        );
      }}
    </Loaded>
  );
}

/** The external calendar's name and the page of its connection, which only the server knows. */
interface CalendarLink {
  name: string;
  href: string;
}

/** The connection to the external calendar is on its own page (plugin-settings.md §2.2): a link here. */
function CalendarLinkSection({ link }: { link: CalendarLink }) {
  const settings = useTranslations("settings");
  return (
    <SettingsSection
      title={link.name}
      description={settings("plugin.movedHint", { provider: link.name })}
      action={
        <ButtonLink href={link.href} size="sm">
          {settings("plugin.settingsOf", { provider: link.name })}
        </ButtonLink>
      }
    />
  );
}
