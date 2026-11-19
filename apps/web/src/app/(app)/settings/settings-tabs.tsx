"use client";

import type { Route } from "next";
import { usePathname } from "next/navigation";
import { TabLinks } from "@ledgerly/ui/tab-links";

type Tab = { href: Route; label: string };

/** A tab is open on its own page and on the pages under it ("Advanced" is under Integrations). */
function isOpen(tab: Tab, pathname: string): boolean {
  return pathname === tab.href || pathname.startsWith(`${tab.href}/`);
}

export function SettingsTabs({ label, tabs }: { label: string; tabs: Tab[] }) {
  const pathname = usePathname();
  return <TabLinks label={label} tabs={tabs.map((tab) => ({ ...tab, active: isOpen(tab, pathname) }))} />;
}

/** The topbar title under the "Settings" crumb: the open tab's name. */
export function SettingsTitle({ tabs }: { tabs: Tab[] }) {
  const pathname = usePathname();
  return tabs.find((tab) => isOpen(tab, pathname))?.label ?? null;
}
