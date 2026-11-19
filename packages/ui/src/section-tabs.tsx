"use client";

// The tabs of a section (audit UI-NAV-3): one declaration of the section's pages gives the strip
// of tabs and the title the topbar shows under the section's crumb. A tab is a page of its own.
import { usePathname } from "./router";
import { TabLinks } from "./tab-links";

interface SectionTab {
  href: string;
  label: string;
}

/** A tab is open on its own page and on the pages under it ("Advanced" is under Integrations). */
function isOpen(tab: SectionTab, pathname: string): boolean {
  return pathname === tab.href || pathname.startsWith(`${tab.href}/`);
}

export function SectionTabs({ label, tabs }: { label: string; tabs: SectionTab[] }) {
  const pathname = usePathname();
  return <TabLinks label={label} tabs={tabs.map((tab) => ({ ...tab, active: isOpen(tab, pathname) }))} />;
}

/** The topbar title under the section's crumb: the open tab's name. */
export function SectionTitle({ tabs }: { tabs: SectionTab[] }) {
  const pathname = usePathname();
  return tabs.find((tab) => isOpen(tab, pathname))?.label ?? null;
}
