"use client";

import { Dialog } from "@base-ui/react/dialog";
import { ChevronRight, Ellipsis } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Avatar } from "@/ui/avatar";
import { Button } from "@/ui/button";
import { cn } from "@/ui/cn";
import { isActive } from "./active";
import { NAV_ICONS } from "./icons";
import type { NavLink } from "./nav-types";
import { useShell } from "./shell-context";
import { useSignOut } from "./sign-out";

const GROUPS = ["finance", "work", "system"] as const;

/** In the More sheet the sidebar's footer items (Settings) open the System group, as in the design. */
function sheetGroups(links: NavLink[]) {
  const ordered = [
    ...links.filter((link) => link.group === "footer"),
    ...links.filter((link) => link.group !== "footer"),
  ];
  return GROUPS.map((group) => ({
    group,
    items: ordered.filter((link) => (link.group === "footer" ? "system" : link.group) === group),
  })).filter(({ items }) => items.length > 0);
}

/** Below 768 px: bottom tabs for the main pages and a "More" sheet for the rest (design mobile frame). */
export function MobileNav({ links, user }: { links: NavLink[]; user: { name: string; via: string } }) {
  const pathname = usePathname();
  const signOut = useSignOut();
  const { labels } = useShell();
  const [moreOpen, setMoreOpen] = useState(false);
  const tabs = links.filter((link) => link.mobile);
  const groups = sheetGroups(links.filter((link) => !link.mobile));

  return (
    <>
      <nav
        aria-label={labels.primary}
        className="fixed inset-x-0 bottom-0 z-40 grid h-16 grid-cols-5 border-t border-border bg-card pb-2 md:hidden"
      >
        {tabs.map((link) => {
          const Icon = NAV_ICONS[link.icon];
          const active = isActive(pathname, link.href);
          return (
            <Link
              key={link.id}
              href={link.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "focus-ring-inset flex flex-col items-center justify-center gap-1 text-micro font-medium",
                active ? "text-accent" : "text-muted",
              )}
            >
              <Icon aria-hidden className="size-5" />
              {link.label}
            </Link>
          );
        })}
        <button
          type="button"
          aria-haspopup="dialog"
          aria-expanded={moreOpen}
          onClick={() => setMoreOpen(true)}
          className={cn(
            "focus-ring-inset col-start-5 flex flex-col items-center justify-center gap-1 text-micro font-medium",
            moreOpen ? "text-accent" : "text-muted",
          )}
        >
          <Ellipsis aria-hidden className="size-5" />
          {labels.more}
        </button>
      </nav>
      <Dialog.Root open={moreOpen} onOpenChange={setMoreOpen}>
        <Dialog.Portal>
          <Dialog.Backdrop className="fixed inset-0 z-50 bg-[rgba(10,12,16,0.25)] md:hidden" />
          <Dialog.Popup className="fixed inset-x-0 bottom-16 z-50 animate-in rounded-t-2xl border-t border-border bg-card p-2 md:hidden">
            <Dialog.Title className="sr-only">{labels.more}</Dialog.Title>
            <div aria-hidden className="mx-auto mt-0.5 mb-1.5 h-1 w-9 rounded-full bg-border2" />
            {groups.map(({ group, items }, index) => (
              <div
                key={group}
                role="group"
                aria-labelledby={`more-${group}`}
                className={cn(
                  "mb-1.5 flex flex-col border-b pb-1.5",
                  index === groups.length - 1 ? "border-border" : "border-transparent",
                )}
              >
                <div
                  id={`more-${group}`}
                  className="px-3 pt-2 pb-1 text-xs font-medium tracking-[0.04em] text-faint uppercase"
                >
                  {labels.groups[group]}
                </div>
                {items.map((link) => {
                  const Icon = NAV_ICONS[link.icon];
                  const active = isActive(pathname, link.href);
                  return (
                    <Link
                      key={link.id}
                      href={link.href}
                      onClick={() => setMoreOpen(false)}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "focus-ring-inset flex h-11 items-center gap-3 rounded-lg px-3 font-medium hover:bg-hover",
                        active ? "text-accent" : "text-fg",
                      )}
                    >
                      <Icon aria-hidden className="size-[18px] text-muted" />
                      <span className="flex-1">{link.label}</span>
                      <ChevronRight aria-hidden className="size-3.5 text-faint" />
                    </Link>
                  );
                })}
              </div>
            ))}
            <div className="flex h-12 items-center gap-3 px-3">
              <Avatar name={user.name} size={28} decorative />
              <div className="min-w-0 flex-1 leading-[1.2]">
                <div className="truncate font-medium">{user.name}</div>
                <div className="truncate text-xs text-muted">{user.via}</div>
              </div>
              <Button size="sm" className="h-8" onClick={signOut}>
                {labels.signOut}
              </Button>
            </div>
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
