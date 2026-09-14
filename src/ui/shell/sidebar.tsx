"use client";

import { LogOut } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Avatar } from "@/ui/avatar";
import { IconButton } from "@/ui/button";
import { cn } from "@/ui/cn";
import { isActive } from "./active";
import { BrandMark } from "./brand";
import { NAV_ICONS } from "./icons";
import type { NavLink } from "./nav-types";
import { type SidebarState, useShell } from "./shell-context";
import { useSignOut } from "./sign-out";

const GROUPS = ["finance", "work", "system"] as const;

/** A sidebar item's look; the Components page shows its states from the same classes. */
export function navItemClassName(active: boolean): string {
  return cn(
    "focus-ring-inset flex h-8 items-center gap-2.5 rounded-ctl px-2 text-muted hover:bg-hover hover:text-fg",
    active && "bg-hover font-medium text-fg",
  );
}

/** What shows next to the icons: nothing when collapsed, everything when expanded, from 1280 px on "auto". */
function visibility(sidebar: SidebarState, shown: "block" | "inline" | "inline-grid"): string {
  if (sidebar === "collapsed") return "hidden";
  if (sidebar === "expanded") return shown;
  return { block: "hidden xl:block", inline: "hidden xl:inline", "inline-grid": "hidden xl:inline-grid" }[
    shown
  ];
}

function Item({ link, active, sidebar }: { link: NavLink; active: boolean; sidebar: SidebarState }) {
  const Icon = NAV_ICONS[link.icon];
  return (
    <Link
      href={link.href}
      title={link.label}
      aria-current={active ? "page" : undefined}
      className={navItemClassName(active)}
    >
      <Icon aria-hidden className="size-4 shrink-0" />
      <span className={cn("truncate", visibility(sidebar, "inline"))}>{link.label}</span>
    </Link>
  );
}

export function Sidebar({ links, user }: { links: NavLink[]; user: { name: string; via: string } }) {
  const pathname = usePathname();
  const signOut = useSignOut();
  const { sidebar, labels } = useShell();
  const label = visibility(sidebar, "block");
  // The name stays readable to assistive tech when hidden: it names the Profile link.
  const nameBlock = { collapsed: "sr-only", expanded: "", auto: "sr-only xl:not-sr-only" }[sidebar];

  return (
    <nav
      aria-label={labels.primary}
      data-sidebar={sidebar}
      className={cn(
        "hidden shrink-0 flex-col gap-1 border-r border-border bg-side px-2 py-3 transition-[width] duration-[180ms] md:flex",
        { collapsed: "w-14", expanded: "w-60", auto: "w-14 xl:w-60" }[sidebar],
      )}
    >
      <div className="mb-2 flex h-8 items-center gap-2.5 px-2">
        <BrandMark />
        <span className={cn("font-semibold whitespace-nowrap", label)}>{labels.product}</span>
      </div>
      <div className="flex flex-1 flex-col overflow-y-auto">
        {GROUPS.map((group) => {
          const items = links.filter((link) => link.group === group);
          if (items.length === 0) return null;
          return (
            <div key={group} className="mb-3 flex flex-col gap-0.5">
              <span
                className={cn(
                  "px-2 pt-1.5 pb-1 text-xs font-medium tracking-[0.04em] text-faint uppercase",
                  label,
                )}
              >
                {labels.groups[group]}
              </span>
              {items.map((link) => (
                <Item key={link.id} link={link} active={isActive(pathname, link.href)} sidebar={sidebar} />
              ))}
            </div>
          );
        })}
      </div>
      {links
        .filter((link) => link.group === "footer")
        .map((link) => (
          <Item key={link.id} link={link} active={isActive(pathname, link.href)} sidebar={sidebar} />
        ))}
      <div className="mt-2 mb-1 h-px bg-border" />
      <div className="flex h-9 items-center gap-2.5 px-1.5">
        <Link
          href="/settings/profile"
          title={labels.profile}
          className="focus-ring group flex min-w-0 flex-1 items-center gap-2.5 rounded-ctl"
        >
          <Avatar name={user.name} decorative />
          <span className={cn("flex min-w-0 flex-1 flex-col leading-[1.2]", nameBlock)}>
            <span className="truncate font-medium group-hover:text-accent">{user.name}</span>
            <span className="truncate text-xs text-muted">{user.via}</span>
          </span>
        </Link>
        <IconButton label={labels.signOut} onClick={signOut} className={visibility(sidebar, "inline-grid")}>
          <LogOut aria-hidden className="size-3.5" />
        </IconButton>
      </div>
    </nav>
  );
}
