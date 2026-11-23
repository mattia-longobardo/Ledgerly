"use client";

// The shell of every signed-in page (audit UI-NAV-1): the sidebar, the mobile tabs and the command
// palette around the page. What it shows of the person — the name and how they sign in — is read from
// `/api/v1`; the theme is saved there. The first day of the week comes from the layout: a context that
// changed once the preferences arrived would reach the pages' boundaries while they still stream. The links of the menu and of the
// palette come from the layout, which knows the role; the two searches of the palette are `/api/v1`'s.
import { useTranslations } from "next-intl";
import type { ComponentProps, ReactNode } from "react";
import { call } from "@ledgerly/api-client";
import { searchRecords } from "@ledgerly/api-contract/core";
import { profile } from "@ledgerly/api-contract/settings";
import { movements } from "@ledgerly/api-contract/transactions";
import { useApi } from "@ledgerly/ui/data";
import { HiddenAmounts } from "@ledgerly/ui/hidden-amounts";
import { CommandPalette } from "@ledgerly/ui/shell/command-palette";
import { MobileNav } from "@ledgerly/ui/shell/mobile-nav";
import { useSaveTheme, useShellLabels } from "@ledgerly/ui/shell/shell-labels";
import type { NavLink } from "@ledgerly/ui/shell/nav-types";
import type { SidebarState } from "@ledgerly/ui/shell/sidebar-state";
import { Sidebar } from "@ledgerly/ui/shell/sidebar";
import { Toaster } from "@ledgerly/ui/toast";
import { WeekStartProvider } from "@ledgerly/ui/week-start";
import { AppShellProvider } from "@/ui/app-shell-provider";
import type { AddonId } from "@ledgerly/api-contract";
import { AddonsProvider } from "./addons-context";

type PaletteProps = ComponentProps<typeof CommandPalette>;

type SearchRecord = { id: string; accountId: string | null };

/** Where a record of the palette leads: a pocket's own page, a fund's account (R5b), the subscriptions. */
const RECORD_PAGES = {
  pocket: (record: SearchRecord) => `/pockets/${record.id}`,
  fund: (record: SearchRecord) => (record.accountId ? `/investments/${record.accountId}` : "/investments"),
  subscription: () => "/subscriptions",
} as const;

const searchPayees: PaletteProps["searchPayees"] = async (term) =>
  (await call(movements.searchPayees, { query: { q: term } })).payees;

export function AppShell({
  initialSidebar,
  weekStart,
  hideAmounts,
  addons,
  links,
  searchLinks,
  children,
}: {
  initialSidebar: SidebarState;
  weekStart: 0 | 1;
  /** «Hide amounts» of the person (R5e): every screen masks its amounts. */
  hideAmounts: boolean;
  /** The addons that are on (the session's); absent, all of them. */
  addons?: readonly AddonId[];
  links: NavLink[];
  searchLinks: NavLink[];
  children: ReactNode;
}) {
  const text = useTranslations();
  const findRecords: PaletteProps["searchRecords"] = async (term) =>
    (await call(searchRecords, { query: { q: term } })).records.map((record) => ({
      id: `${record.kind}:${record.id}`,
      label: record.name,
      hint: text(`shell.palette.${record.kind}`),
      href: RECORD_PAGES[record.kind](record),
    }));
  const person = useApi(profile.getProfile, {});
  const saveTheme = useSaveTheme();
  const labels = useShellLabels();
  const user = {
    name: person.data?.name ?? "",
    via: text(person.data?.managedByProvider ? "shell.via.sso" : "shell.via.password"),
  };
  return (
    <AppShellProvider initialSidebar={initialSidebar} labels={labels} saveTheme={saveTheme}>
      <WeekStartProvider value={weekStart}>
        <HiddenAmounts hidden={hideAmounts}>
          <AddonsProvider addons={addons}>
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
              searchRecords={findRecords}
            />
            <Toaster closeLabel={text("common.close")} />
          </AddonsProvider>
        </HiddenAmounts>
      </WeekStartProvider>
    </AppShellProvider>
  );
}
