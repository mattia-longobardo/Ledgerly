"use client";

import type { Route } from "next";
import { usePathname } from "next/navigation";
import { TabLinks } from "@/ui/tab-links";

export function SettingsTabs({ tabs }: { tabs: { href: Route; label: string }[] }) {
  const pathname = usePathname();
  return <TabLinks tabs={tabs.map((tab) => ({ ...tab, active: pathname === tab.href }))} />;
}
