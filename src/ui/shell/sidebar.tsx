"use client";

import { LogOut } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { authClient } from "@/platform/auth/client";
import { Avatar } from "@/ui/avatar";
import { IconButton } from "@/ui/button";
import { cn } from "@/ui/cn";
import { isActive } from "./active";
import { BrandMark } from "./brand";
import { NAV_ICONS } from "./icons";
import type { NavLink } from "./nav-types";
import { useShell } from "./shell-context";

const GROUPS = ["finance", "work", "system"] as const;

function Item({ link, active, collapsed }: { link: NavLink; active: boolean; collapsed: boolean }) {
  const Icon = NAV_ICONS[link.icon];
  return (
    <Link
      href={link.href}
      title={link.label}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex h-8 items-center gap-2.5 rounded-ctl px-2 text-muted hover:bg-hover",
        "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent",
        active && "bg-hover font-medium text-fg",
      )}
    >
      <Icon aria-hidden className="size-4 shrink-0" />
      <span className={cn("truncate", collapsed ? "hidden" : "hidden xl:inline")}>{link.label}</span>
    </Link>
  );
}

export function Sidebar({ links, user }: { links: NavLink[]; user: { name: string; via: string } }) {
  const pathname = usePathname();
  const router = useRouter();
  const { collapsed, labels } = useShell();
  const label = collapsed ? "hidden" : "hidden xl:block";

  async function signOut() {
    await authClient.signOut();
    // `/sign-in` is created in Task 17; typed routes accept it only through the cast until then.
    router.push("/sign-in" as Route);
  }

  return (
    <nav
      aria-label={labels.primary}
      data-collapsed={collapsed}
      className={cn(
        "hidden shrink-0 flex-col gap-1 border-r border-border bg-side px-2 py-3 transition-[width] duration-[180ms] md:flex",
        collapsed ? "w-14" : "w-14 xl:w-60",
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
                <Item
                  key={link.id}
                  link={link}
                  active={isActive(pathname, link.href)}
                  collapsed={collapsed}
                />
              ))}
            </div>
          );
        })}
      </div>
      {links
        .filter((link) => link.group === "footer")
        .map((link) => (
          <Item key={link.id} link={link} active={isActive(pathname, link.href)} collapsed={collapsed} />
        ))}
      <div className="mt-2 mb-1 h-px bg-border" />
      <div className="flex h-9 items-center gap-2 px-1">
        <Avatar name={user.name} decorative />
        <div className={cn("min-w-0 flex-1 leading-tight", label)}>
          <div className="truncate font-medium">{user.name}</div>
          <div className="truncate text-xs text-muted">{user.via}</div>
        </div>
        <IconButton label={labels.signOut} onClick={signOut} className={label}>
          <LogOut aria-hidden className="size-3.5" />
        </IconButton>
      </div>
    </nav>
  );
}
