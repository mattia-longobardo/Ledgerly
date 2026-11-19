"use client";

// Settings › Profile, read from `/api/v1` (rewrite plan R3): the person's name and their preferences.
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useRef } from "react";
import { SETTINGS } from "@ledgerly/api-contract";
import type { RouteOutput } from "@ledgerly/api-client";
import { DISPLAY_CURRENCIES } from "@ledgerly/domain/platform/fx/client";
import type { Preferences } from "@ledgerly/domain/users/client";
import { useApi } from "@ledgerly/ui/data";
import { Loaded } from "@ledgerly/ui/loaded";
import { SettingsGrid, SettingsSection } from "@ledgerly/ui/section";
import { NameForm } from "./name-form";
import { PreferencesForm } from "./preferences-form";

const { profile } = SETTINGS;

/**
 * The saved preferences as the form holds them: the API answers the display currency as any code,
 * the form offers only the ones it can show (EUR and the ECB's). An unknown one shows as the error.
 */
function formPreferences(saved: RouteOutput<typeof profile.getPreferences>): Preferences | null {
  const currency = DISPLAY_CURRENCIES.find((code) => code === saved.displayCurrency);
  return currency ? { ...saved, displayCurrency: currency } : null;
}

/**
 * The shell is still drawn on the server with the saved language and theme: when the preferences
 * change, it is drawn again, as the Server Action's `revalidatePath` of the layout did.
 */
function useRedrawOnChange(value: unknown) {
  const router = useRouter();
  const first = useRef(value);
  useEffect(() => {
    if (value !== undefined && first.current !== undefined && value !== first.current) router.refresh();
    if (first.current === undefined) first.current = value;
  }, [value, router]);
}

export function ProfileScreen({
  timeZones,
  summaryBlocked,
}: {
  timeZones: { value: string; label: string }[];
  summaryBlocked: boolean;
}) {
  const text = useTranslations("settings");
  const person = useApi(profile.getProfile, {});
  const preferences = useApi(profile.getPreferences, {});
  useRedrawOnChange(preferences.data);
  useRedrawOnChange(person.data);

  return (
    <SettingsGrid>
      <SettingsSection title={text("account.title")} description={text("account.description")}>
        <Loaded state={person}>
          {(self) => (
            <NameForm name={self.name} email={self.email} role={self.role} sso={self.managedByProvider} />
          )}
        </Loaded>
      </SettingsSection>
      <SettingsSection title={text("preferences.title")} description={text("preferences.description")}>
        <Loaded state={preferences}>
          {(saved) => {
            const initial = formPreferences(saved);
            return initial ? (
              <PreferencesForm
                key={JSON.stringify(initial)}
                initial={initial}
                timeZones={timeZones}
                summaryBlocked={summaryBlocked}
              />
            ) : (
              <p role="alert" className="text-sm text-neg">
                {text("preferences.errors.failed")}
              </p>
            );
          }}
        </Loaded>
      </SettingsSection>
    </SettingsGrid>
  );
}
