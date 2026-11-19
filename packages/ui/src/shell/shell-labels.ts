"use client";

// What every container's shell needs from the person's words and from `/api/v1` (audit UI-NAV-1): the
// labels of the shell and the save of the theme. The web app and the static package draw the same.
import { useCallback, useMemo } from "react";
import { useTranslations } from "use-intl";
import { profile } from "@ledgerly/api-contract/settings";
import { call } from "@ledgerly/api-client";
import { invalidate } from "../data";
import { browserPreferences } from "../preferences";
import { useRouter } from "../router";
import type { ThemePreference } from "../theme";

/**
 * The shell's labels and its save of the theme stay the same objects between renders: they are the
 * value of the shell's context, and a new value would reach the pages' boundaries while they still
 * stream (a render of the shell when the person arrives would draw a page twice).
 */
export function useShellLabels() {
  const text = useTranslations();
  return useMemo(
    () => ({
      product: text("common.product"),
      primary: text("nav.primary"),
      groups: {
        finance: text("nav.groups.finance"),
        work: text("nav.groups.work"),
        system: text("nav.groups.system"),
      },
      toggleSidebar: text("shell.toggleSidebar"),
      search: text("shell.search"),
      toggleTheme: text("shell.toggleTheme"),
      themeSaveError: text("shell.themeSaveError"),
      signOut: text("shell.signOut"),
      profile: text("shell.profile"),
      more: text("nav.more"),
      palette: {
        placeholder: text("shell.palette.placeholder"),
        pages: text("shell.palette.pages"),
        records: text("shell.palette.records"),
        payees: text("expenses.palette.payees"),
        empty: text("shell.palette.empty"),
        shortcut: text("shell.palette.shortcut"),
        escape: text("shell.palette.escape"),
      },
    }),
    [text],
  );
}

/** Saves the theme as the person's preference, and on the device for the pages without a session. */
export function useSaveTheme() {
  const router = useRouter();
  return useCallback(
    async (theme: ThemePreference) => {
      const saved = await call(profile.updatePreferences, { body: { theme } });
      browserPreferences.write("theme", saved.theme);
      invalidate(profile.getPreferences);
      router.refresh();
    },
    [router],
  );
}
