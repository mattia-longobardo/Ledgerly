"use client";

import type { Route } from "next";
import { usePathname } from "next/navigation";
import { TabLinks } from "@/ui/tab-links";

type Tab = { href: Route; label: string };

export function SettingsTabs({ label, tabs }: { label: string; tabs: Tab[] }) {
  const pathname = usePathname();
  return <TabLinks label={label} tabs={tabs.map((tab) => ({ ...tab, active: pathname === tab.href }))} />;
}

/** The topbar title under the "Settings" crumb: the open tab's name. */
export function SettingsTitle({ tabs }: { tabs: Tab[] }) {
  const pathname = usePathname();
  return tabs.find((tab) => tab.href === pathname)?.label ?? null;
}
