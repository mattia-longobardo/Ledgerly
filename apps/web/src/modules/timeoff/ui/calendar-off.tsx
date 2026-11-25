"use client";

// The leave calendar when it is off (H56, PERS-615 §4): a day booked here is a day of Ledgerly, and
// no day says «To send» to a calendar that is not active; the days that still wait for it are said
// once, in a banner, with the way to clean it up.
import { useTranslations } from "next-intl";
import { sources } from "@ledgerly/api-contract/settings";
import { Banner } from "@ledgerly/ui/banner";
import { ButtonLink } from "@ledgerly/ui/button";
import { useApi } from "@ledgerly/ui/data";

/** The leave calendar the instance has, as the person has it; undefined while none or unread. */
function useCalendar() {
  const plugins = useApi(sources.listPlugins, {});
  return plugins.data?.plugins.find((one) => one.kind === "calendar");
}

/** Whether a day may wear «To send»: only while its calendar is on. */
export function useCalendarOn(): boolean {
  const calendar = useCalendar();
  if (calendar === undefined) return true;
  return calendar.pluginState !== "not_active" && calendar.pluginState !== "needs_cleanup";
}

export function CalendarOffBanner() {
  const text = useTranslations("timeoff.calendarOff");
  const calendar = useCalendar();
  if (calendar?.pluginState !== "needs_cleanup" || calendar.leftovers.pendingDays === 0) return null;
  const provider = calendar.name;
  return (
    <Banner
      tone="warn"
      title={text("title", { count: calendar.leftovers.pendingDays, provider })}
      testId="calendar-off"
      action={
        <ButtonLink href={`/settings/plugins/${calendar.id}`} size="sm">
          {text("fix", { provider })}
        </ButtonLink>
      }
    >
      {text("body", { provider })}
    </Banner>
  );
}
