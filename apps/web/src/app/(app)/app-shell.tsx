"use client";

// The shell of every signed-in page (audit UI-NAV-1): the sidebar, the mobile tabs and the command
// palette around the page. What it shows of the person — the name and how they sign in — is read from
// `/api/v1`; the theme is saved there. The first day of the week comes from the layout: a context that
// changed once the preferences arrived would reach the pages' boundaries while they still stream. The links of the menu and of the
// palette come from the layout, which knows the role; the two searches of the palette are still Server
// Actions of their modules (`baselines/server-actions.json`).
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { type ComponentProps, type ReactNode, useCallback, useMemo } from "react";
import { profile } from "@ledgerly/api-contract/settings";
import { call } from "@ledgerly/api-client";
import { invalidate, useApi } from "@ledgerly/ui/data";
import { CommandPalette } from "@ledgerly/ui/shell/command-palette";
import { MobileNav } from "@ledgerly/ui/shell/mobile-nav";
import { browserPreferences } from "@ledgerly/ui/preferences";
import type { NavLink } from "@ledgerly/ui/shell/nav-types";
import type { SidebarState } from "@ledgerly/ui/shell/sidebar-state";
import { Sidebar } from "@ledgerly/ui/shell/sidebar";
import type { ThemePreference } from "@ledgerly/ui/theme";
import { Toaster } from "@ledgerly/ui/toast";
import { WeekStartProvider } from "@ledgerly/ui/week-start";
import { AppShellProvider } from "@/ui/app-shell-provider";

type PaletteProps = ComponentProps<typeof CommandPalette>;

/**
 * The shell's labels and its save of the theme stay the same objects between renders: they are the
 * value of the shell's context, and a new value would reach the pages' boundaries while they still
 * stream (a render of the shell when the person arrives would draw a page twice).
 */
function useLabels() {
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
function useSaveTheme() {
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

export function AppShell({
  initialSidebar,
  weekStart,
  links,
  searchLinks,
  searchPayees,
  searchRecords,
  children,
}: {
  initialSidebar: SidebarState;
  weekStart: 0 | 1;
  links: NavLink[];
  searchLinks: NavLink[];
  searchPayees: PaletteProps["searchPayees"];
  searchRecords: PaletteProps["searchRecords"];
  children: ReactNode;
}) {
  const text = useTranslations();
  const person = useApi(profile.getProfile, {});
  const saveTheme = useSaveTheme();
  const labels = useLabels();
  const user = {
    name: person.data?.name ?? "",
    via: text(person.data?.managedByProvider ? "shell.via.sso" : "shell.via.password"),
  };
  return (
    <AppShellProvider initialSidebar={initialSidebar} labels={labels} saveTheme={saveTheme}>
      <WeekStartProvider value={weekStart}>
        <div className="flex h-dvh overflow-hidden">
          <Sidebar links={links} user={user} />
          {/* `relative`: the containing block of every absolutely placed element of a page. Without it
            an `sr-only` label far down a long list was placed against the viewport instead, and
            stretched the document itself: a second scrollbar over an empty half page (2026-09-18). */}
          <div className="relative flex min-w-0 flex-1 flex-col overflow-y-auto">{children}</div>
        </div>
        <MobileNav links={links} user={user} />
        <CommandPalette
          links={links}
          searchLinks={searchLinks}
          searchPayees={searchPayees}
          searchRecords={searchRecords}
        />
        <Toaster closeLabel={text("common.close")} />
      </WeekStartProvider>
    </AppShellProvider>
  );
}
