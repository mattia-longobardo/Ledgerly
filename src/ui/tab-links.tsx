import type { Route } from "next";
import Link from "next/link";
import { cn } from "./cn";

/**
 * Route-based tabs (Settings sections): each tab is a link; the active one carries aria-current.
 *
 * They wrap rather than scroll. Six sections — the Settings strip once an admin signs in — do not
 * fit a 400 px phone on one line, and a row that slides sideways hides the tabs at its end behind
 * a gesture nobody is told about. Two short lines show all of them at once.
 */
export function TabLinks({
  label,
  tabs,
}: {
  label: string;
  tabs: { href: Route; label: string; active: boolean }[];
}) {
  return (
    <nav aria-label={label} className="flex flex-wrap gap-x-1 border-b border-border">
      {tabs.map((tab) => (
        <Link
          key={tab.href}
          href={tab.href}
          aria-current={tab.active ? "page" : undefined}
          className={cn(
            "focus-ring-inset -mb-px inline-flex h-[34px] items-center border-b-2 px-3 font-medium",
            // A wrapped line still sits on the rule: the bottom border is the strip's, not the row's.
            tab.active ? "border-fg text-fg" : "border-transparent text-muted hover:text-fg",
          )}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
