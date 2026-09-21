import type { Metadata } from "next";
import { headers } from "next/headers";
import { getTranslations } from "next-intl/server";
import { getPreferences } from "@/modules/users/service";
import { hasPasswordAccount, hasSsoAccount } from "@/platform/auth/accounts";
import { getAuth } from "@/platform/auth/auth";
import { requireSession } from "@/platform/auth/session";
import { civilDateIn, today, utcOffsetLabel } from "@/platform/dates";
import { formatDate } from "@/platform/format";
import { countDaysByCalendar, listCalendars } from "@/platform/holidays/service";
import { SettingsGrid, SettingsSection } from "@/ui/section";
import { HolidayCalendars, type CalendarRow } from "./holiday-calendars";
import { NameForm } from "./name-form";
import { PreferencesForm } from "./preferences-form";
import { SignInMethod } from "./sign-in-method";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("settings");
  return { title: `${t("tabs.profile")} · ${t("title")}` };
}

export default async function ProfilePage() {
  const ctx = await requireSession();
  const [session, sso, password, preferences, calendars] = await Promise.all([
    getAuth().api.getSession({ headers: await headers() }),
    hasSsoAccount(ctx.userId),
    hasPasswordAccount(ctx.userId),
    getPreferences(ctx),
    listCalendars(ctx),
  ]);
  const t = await getTranslations("settings");
  const now = new Date();
  const timeZones = Intl.supportedValuesOf("timeZone").map((zone) => ({
    value: zone,
    label: `${zone} (${utcOffsetLabel(zone, now)})`,
  }));

  // How many days each calendar holds for the year on screen, counted in one query rather than one
  // per calendar.
  const year = Number(today(ctx.timeZone, now).slice(0, 4));
  const counts = await countDaysByCalendar(ctx, year);
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
  return (
    <SettingsGrid>
      <SettingsSection title={t("account.title")} description={t("account.description")}>
        <NameForm
          name={session?.user.name ?? ""}
          email={session?.user.email ?? ""}
          role={ctx.role}
          sso={sso}
        />
      </SettingsSection>
      <SettingsSection title={t("signIn.title")} description={t("signIn.description")}>
        <SignInMethod sso={sso} password={password} />
      </SettingsSection>
      <SettingsSection title={t("preferences.title")} description={t("preferences.description")}>
        <PreferencesForm key={JSON.stringify(preferences)} initial={preferences} timeZones={timeZones} />
      </SettingsSection>
      <SettingsSection title={t("holidays.title")} description={t("holidays.description")}>
        <HolidayCalendars calendars={calendarRows} year={year} />
      </SettingsSection>
    </SettingsGrid>
  );
}
