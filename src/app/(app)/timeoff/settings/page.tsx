import type { Metadata, Route } from "next";
import { getTranslations } from "next-intl/server";
import { allowanceOf, listAllowances, pendingCount } from "@/modules/timeoff/service";
import type { Allowance } from "@/modules/timeoff/service";
import type { AllowanceSummary } from "@/modules/timeoff/ui/leave-actions";
import { AllowanceForm, PatronSaintForm, WorkingHoursForm } from "@/modules/timeoff/ui/settings-forms";
import { YearPicker } from "@/modules/timeoff/ui/year-picker";
import { getPreferences } from "@/modules/users/service";
import { ConnectionRow } from "@/app/(app)/settings/integrations/connection-row";
import { formatInstant } from "@/app/(app)/settings/integrations/format-instant";
import { recommendedSchedule } from "@/app/(app)/settings/integrations/recommended-schedule";
import { ScheduleControl } from "@/app/(app)/settings/integrations/schedule-control";
import { requireSession } from "@/platform/auth/session";
import { civilDateIn, today as todayIn } from "@/platform/dates";
import { formatDate } from "@/platform/format";
import { countDaysByCalendar, listCalendars } from "@/platform/holidays/service";
import { TREK_PROVIDER } from "@/platform/integrations/rules";
import { listConnections } from "@/platform/integrations/service";
import { ButtonLink } from "@/ui/button";
import { SettingsGrid, SettingsSection } from "@/ui/section";
import { Page } from "@/ui/shell/page";
import { TabLinks } from "@/ui/tab-links";
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
 * allowance, how long a working day is, the holidays, and the Trek link. The values keep their own
 * tables; the connection itself is still managed on Settings › Integrations, like every other.
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

  const [allowance, previous, allowances, preferences, calendars, counts, connections] = await Promise.all([
    allowanceOf(ctx, year),
    allowanceOf(ctx, year - 1),
    listAllowances(ctx),
    getPreferences(ctx),
    listCalendars(ctx),
    countDaysByCalendar(ctx, currentYear),
    listConnections(ctx),
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

  const trek = connections.find((connection) => connection.provider === TREK_PROVIDER) ?? null;
  const waiting = trek ? await pendingCount(ctx) : 0;
  const hrefFor = (one: number) => `/timeoff/settings?year=${one}` as Route;

  return (
    <Page title={t("tabs.settings")} parent={{ href: "/timeoff", label: t("title") }}>
      <div className="flex flex-col gap-4">
        <h1 className="text-title font-semibold tracking-[-0.02em]">{t("heading")}</h1>
        <TabLinks
          label={t("tabs.label")}
          tabs={[
            { href: `/timeoff?year=${year}` as Route, label: t("tabs.overview"), active: false },
            { href: hrefFor(year), label: t("tabs.settings"), active: true },
          ]}
        />
      </div>
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
          title={integrations("providers.trek.name")}
          description={t("settings.trek.description")}
          padded={false}
        >
          {trek ? (
            <>
              <ConnectionRow
                name={integrations("providers.trek.name")}
                role={integrations("providers.trek.role")}
                state={trek.state}
                lastSync={trek.lastOkAt ? formatInstant(trek.lastOkAt, ctx) : null}
                schedule={
                  <ScheduleControl
                    provider={trek.provider}
                    name={integrations("providers.trek.name")}
                    schedule={trek.schedule}
                    recommended={recommendedSchedule(trek.provider)}
                    next={trek.nextSyncAt ? formatInstant(trek.nextSyncAt, ctx) : null}
                    timeZone={ctx.timeZone}
                  />
                }
                actions={
                  <ButtonLink href="/settings/integrations" size="sm">
                    {t("settings.trek.manage")}
                  </ButtonLink>
                }
              />
              {waiting > 0 && (
                <p className="border-t border-border px-4 py-2.5 text-sm text-muted">
                  {integrations("trek.pending", { count: waiting })}
                </p>
              )}
            </>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-3 p-4">
              <p className="text-sm text-muted">{integrations("trek.notLinked")}</p>
              <ButtonLink href="/settings/integrations" size="sm">
                {t("settings.trek.connect")}
              </ButtonLink>
            </div>
          )}
        </SettingsSection>
      </SettingsGrid>
    </Page>
  );
}
