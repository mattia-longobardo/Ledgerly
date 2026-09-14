"use client";

import type { Route } from "next";
import { usePathname } from "next/navigation";
import { TabLinks } from "@/ui/tab-links";

export function SettingsTabs({ label, tabs }: { label: string; tabs: { href: Route; label: string }[] }) {
  const pathname = usePathname();
  return <TabLinks label={label} tabs={tabs.map((tab) => ({ ...tab, active: pathname === tab.href }))} />;
}
