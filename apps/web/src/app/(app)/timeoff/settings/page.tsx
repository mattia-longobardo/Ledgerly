import type { Metadata, Route } from "next";
import { getTranslations } from "next-intl/server";
import { allowanceOf, listAllowances } from "@ledgerly/domain/timeoff";
import type { Allowance } from "@ledgerly/domain/timeoff";
import type { AllowanceSummary } from "@/modules/timeoff/ui/leave-actions";
import { AllowanceForm, PatronSaintForm, WorkingHoursForm } from "@/modules/timeoff/ui/settings-forms";
import { YearPicker } from "@/modules/timeoff/ui/year-picker";
import { getPreferences } from "@ledgerly/domain/users";
import { sourceHref } from "@/app/(app)/settings/integrations/connection-view";
import { requireSession } from "@/platform/auth/session";
import { civilDateIn, today as todayIn } from "@ledgerly/domain/shared/dates";
import { formatDate } from "@ledgerly/domain/platform/format";
import { countDaysByCalendar, listCalendars } from "@ledgerly/domain/platform/holidays";
import { TREK_PROVIDER } from "@ledgerly/domain/platform/integrations";
import { ButtonLink } from "@/ui/button";
import { SettingsGrid, SettingsSection } from "@/ui/section";
import { Page } from "@/ui/shell/page";
import { TabLinks } from "@/ui/tab-links";
import { UnsavedChangesProvider } from "@/ui/unsaved-changes";
import { type CalendarRow, HolidayCalendars } from "./holiday-calendars";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("timeoff");
  return { title: `${t("tabs.settings")} · ${t("title")}` };
}

/** A `numeric(5,2)` as a person would type it back: "26.00" is "26", "0.50" is "0.5". */
function trim(value: string): string {
  return String(Number(value));
}

function summary(year: number, allowance: Allowance | null): AllowanceSummary {
  return {
    year,
    vacationDays: allowance?.vacationDays == null ? "" : trim(allowance.vacationDays),
    rolDays: allowance?.rolDays == null ? "" : trim(allowance.rolDays),
    totalDays: allowance?.totalDays == null ? "" : trim(allowance.totalDays),
    note: allowance?.note ?? "",
  };
}

/**
 * Time off › Settings (PERS-158): everything that only leave depends on, in one place — the year's
 * allowance, how long a working day is, the holidays, and the way to the Trek link. The values keep
 * their own tables; the connection itself is on Trek's page of Settings › Integrations.
 */
export default async function TimeOffSettingsPage({ searchParams }: PageProps<"/timeoff/settings">) {
  const ctx = await requireSession();
  const t = await getTranslations("timeoff");
  const holidays = await getTranslations("settings.holidays");
  const integrations = await getTranslations("settings.integrations");
  const query = await searchParams;

  const currentYear = Number(todayIn(ctx.timeZone).slice(0, 4));
  const asked = Number(Array.isArray(query.year) ? query.year[0] : query.year);
  const year = Number.isInteger(asked) && asked >= 1990 && asked <= currentYear + 1 ? asked : currentYear;

  const plugin = await getTranslations("settings.plugin");
  const [allowance, previous, allowances, preferences, calendars, counts] = await Promise.all([
    allowanceOf(ctx, year),
    allowanceOf(ctx, year - 1),
    listAllowances(ctx),
    getPreferences(ctx),
    listCalendars(ctx),
    countDaysByCalendar(ctx, currentYear),
  ]);

  const calendarRows: CalendarRow[] = calendars.map((calendar) => ({
    id: calendar.id,
    label: calendar.label,
    source: calendar.source,
    country: calendar.country,
    subdivision: calendar.subdivision,
    lastSynced:
      calendar.lastSyncedAt === null
        ? null
        : formatDate(civilDateIn(calendar.lastSyncedAt, ctx.timeZone), "long", ctx.locale),
    lastError: calendar.lastError,
    days: counts[calendar.id] ?? 0,
  }));

  // The connection to Trek is on its own page (plugin-settings.md §2.2): a link here.
  const trekName = integrations("providers.trek.name");
  const trekHref = sourceHref(TREK_PROVIDER) ?? "/settings/integrations";
  const hrefFor = (one: number) => `/timeoff/settings?year=${one}` as Route;

  return (
    <Page title={t("tabs.settings")} parent={{ href: "/timeoff", label: t("title") }}>
      <div className="flex flex-col gap-4">
        <h1 className="text-title font-semibold tracking-title">{t("heading")}</h1>
        <TabLinks
          label={t("tabs.label")}
          tabs={[
            { href: `/timeoff?year=${year}` as Route, label: t("tabs.overview"), active: false },
            { href: hrefFor(year), label: t("tabs.settings"), active: true },
          ]}
        />
      </div>
      {/* Save and Discard for the forms below live in the banner, which appears with a change. */}
      <UnsavedChangesProvider>
        <SettingsGrid>
          <SettingsSection title={t("settings.allowance.title")} description={t("allowance.description")}>
            <div className="@container">
              <AllowanceForm
                key={year}
                allowance={summary(year, allowance)}
                previous={previous ? summary(year - 1, previous) : null}
                stepper={
                  <YearPicker
                    year={year}
                    years={allowances.map((one) => one.year)}
                    currentYear={currentYear}
                    lastYear={currentYear + 1}
                    hrefFor={hrefFor}
                    labels={{
                      label: t("header.yearLabel"),
                      previous: t("header.previousYear"),
                      next: t("header.nextYear"),
                      today: t("header.thisYear"),
                    }}
                  />
                }
              />
            </div>
          </SettingsSection>
          <SettingsSection title={t("settings.hours.title")} description={t("settings.hours.description")}>
            <WorkingHoursForm minutesPerDay={preferences.minutesPerDay} />
          </SettingsSection>
          <SettingsSection title={holidays("title")} description={holidays("description")}>
            <div className="flex flex-col gap-3">
              <HolidayCalendars calendars={calendarRows} year={currentYear} />
              <PatronSaintForm patronSaint={preferences.patronSaint} />
            </div>
          </SettingsSection>
          <SettingsSection
            title={trekName}
            description={plugin("movedHint", { provider: trekName })}
            action={
              <ButtonLink href={trekHref as Route} size="sm">
                {plugin("settingsOf", { provider: trekName })}
              </ButtonLink>
            }
          />
        </SettingsGrid>
      </UnsavedChangesProvider>
    </Page>
  );
}
