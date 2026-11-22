"use client";

// Settings › Alerts (rewrite plan R5e): for each event, its three channels. A locked channel shows its
// value and cannot change (`inApp` of an event that asks for an action, `email` of one with no email);
// the events of an addon that is off are greyed and cannot change either (PA10).
import { useTranslations } from "next-intl";
import { useTransition } from "react";
import { getNotificationPreferences, setNotificationPreference } from "@ledgerly/api-contract";
import { call, type RouteOutput } from "@ledgerly/api-client";
import { cn } from "@ledgerly/ui/cn";
import { remember, useApi } from "@ledgerly/ui/data";
import { Loaded } from "@ledgerly/ui/loaded";
import { SettingsGrid, SettingsSection } from "@ledgerly/ui/section";
import { Switch } from "@ledgerly/ui/switch";
import { notify } from "@ledgerly/ui/toast";

type Preference = RouteOutput<typeof getNotificationPreferences>["events"][number];
type Channel = keyof Preference["channels"];

const CHANNELS: readonly Channel[] = ["inApp", "email", "device"];

export function NotificationsScreen() {
  const text = useTranslations("settings.notifications");
  const state = useApi(getNotificationPreferences, {});
  const [pending, startTransition] = useTransition();

  function change(event: Preference["event"], channel: Channel, active: boolean) {
    startTransition(async () => {
      try {
        const answer = await call(setNotificationPreference, {
          params: { event },
          body: { [channel]: active },
        });
        remember(getNotificationPreferences, {}, answer);
      } catch {
        notify(text("failed"), "error");
      }
    });
  }

  return (
    <SettingsGrid>
      <SettingsSection title={text("title")} description={text("description")} padded={false}>
        <Loaded state={state}>
          {({ events }) => (
            <ul className="flex flex-col divide-y divide-border">
              {events.map((preference) => (
                <EventRow
                  key={preference.event}
                  preference={preference}
                  pending={pending}
                  onChange={change}
                />
              ))}
            </ul>
          )}
        </Loaded>
      </SettingsSection>
    </SettingsGrid>
  );
}

function EventRow({
  preference,
  pending,
  onChange,
}: {
  preference: Preference;
  pending: boolean;
  onChange: (event: Preference["event"], channel: Channel, active: boolean) => void;
}) {
  const text = useTranslations("settings.notifications");
  const events = useTranslations("notifications.names");
  const addons = useTranslations("nav");
  const { event, addon, addonActive, channels, locked, category } = preference;
  const id = `event-${event}`;
  return (
    <li
      data-testid={id}
      className={cn(
        "flex flex-wrap items-center justify-between gap-3 px-4 py-3",
        !addonActive && "opacity-60",
      )}
    >
      <div className="flex min-w-0 flex-col gap-0.5">
        <span id={id} className="font-medium">
          {events(event)}
        </span>
        <span id={`${id}-hint`} className="text-sm text-muted">
          {!addonActive && addon ? text("addonOff", { name: addons(addon) }) : text(`categories.${category}`)}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-4">
        {CHANNELS.map((channel) => {
          const fixed = locked.includes(channel);
          const label = `${id}-${channel}`;
          return (
            <span key={channel} className="flex items-center gap-2 text-sm">
              <span id={label}>{text(channel)}</span>
              <Switch
                checked={channels[channel]}
                onCheckedChange={(active) => onChange(event, channel, active)}
                labelledBy={`${id} ${label}`}
                describedBy={fixed ? `${label}-locked` : `${id}-hint`}
                disabled={pending || fixed || !addonActive}
                data-testid={`${id}-${channel}`}
              />
              {fixed && (
                <span id={`${label}-locked`} className="sr-only">
                  {text("locked")}
                </span>
              )}
            </span>
          );
        })}
      </div>
    </li>
  );
}
