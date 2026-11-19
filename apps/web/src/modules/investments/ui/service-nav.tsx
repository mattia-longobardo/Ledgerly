"use client";

import { usePathname, useSearchParams } from "next/navigation";
import type { ReactNode } from "react";
import { PERIOD_KEYS } from "@ledgerly/domain/investments/client";
import { TabLinks } from "@ledgerly/ui/tab-links";
import { type Params, withParams } from "@ledgerly/ui/url";

export type ServiceTab = { key: string; href: string; label: string; badge?: ReactNode };

function usePeriodParams(): Params {
  const search = useSearchParams();
  return Object.fromEntries(PERIOD_KEYS.map((key) => [key, search.get(key) ?? undefined]));
}

/**
 * The tabs of a service (docs/design/investments-ux.md §1.1, §3.2): routes, not client state, so the
 * back button walks them; each link keeps the period of the address, and nothing else.
 */
export function ServiceTabs({ label, tabs }: { label: string; tabs: ServiceTab[] }) {
  const pathname = usePathname();
  const period = usePeriodParams();
  return (
    <TabLinks
      label={label}
      tabs={tabs.map((tab) => ({
        href: withParams(tab.href, {}, period),
        label: tab.badge ? (
          <span className="inline-flex items-center gap-1.5">
            {tab.label}
            {tab.badge}
          </span>
        ) : (
          tab.label
        ),
        active: pathname === tab.href,
      }))}
    />
  );
}

/** The topbar title under the "Investments" crumb: the service, and the open tab past the first. */
export function ServiceCrumb({ name, tabs }: { name: string; tabs: ServiceTab[] }) {
  const pathname = usePathname();
  const open = tabs.findIndex((tab) => tab.href === pathname);
  return open <= 0 ? name : `${name} / ${tabs[open].label}`;
}
