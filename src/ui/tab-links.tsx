import type { Route } from "next";
import Link from "next/link";
import { cn } from "./cn";

/** Route-based tabs (Settings sections): each tab is a link; the active one carries aria-current. */
export function TabLinks({
  label,
  tabs,
}: {
  label: string;
  tabs: { href: Route; label: string; active: boolean }[];
}) {
  return (
    <nav aria-label={label} className="flex gap-1 border-b border-border">
      {tabs.map((tab) => (
        <Link
          key={tab.href}
          href={tab.href}
          aria-current={tab.active ? "page" : undefined}
          className={cn(
            "focus-ring-inset -mb-px inline-flex h-[34px] items-center border-b-2 px-3 font-medium",
            tab.active ? "border-fg text-fg" : "border-transparent text-muted hover:text-fg",
          )}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
