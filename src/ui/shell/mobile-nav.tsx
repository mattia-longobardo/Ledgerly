"use client";

import { Dialog } from "@base-ui/react/dialog";
import { ChevronRight, Ellipsis } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { cn } from "@/ui/cn";
import { isActive } from "./active";
import { NAV_ICONS } from "./icons";
import type { NavLink } from "./nav-types";
import { useShell } from "./shell-context";

/** Below 768 px: bottom tabs for the main pages and a "More" sheet for the rest (design mobile frame). */
export function MobileNav({ links }: { links: NavLink[] }) {
  const pathname = usePathname();
  const { labels } = useShell();
  const [moreOpen, setMoreOpen] = useState(false);
  const tabs = links.filter((link) => link.mobile);
  const rest = links.filter((link) => !link.mobile);

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
                "flex flex-col items-center justify-center gap-0.5 text-micro font-medium",
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
          onClick={() => setMoreOpen(true)}
          className="col-start-5 flex flex-col items-center justify-center gap-0.5 text-micro font-medium text-muted"
        >
          <Ellipsis aria-hidden className="size-5" />
          {labels.more}
        </button>
      </nav>
      <Dialog.Root open={moreOpen} onOpenChange={setMoreOpen}>
        <Dialog.Portal>
          <Dialog.Backdrop className="fixed inset-0 z-50 bg-[rgba(10,12,16,0.25)] md:hidden" />
          <Dialog.Popup className="fixed inset-x-0 bottom-0 z-50 animate-in rounded-t-2xl border-t border-border bg-card px-4 pt-2 pb-20 md:hidden">
            <Dialog.Title className="sr-only">{labels.more}</Dialog.Title>
            <div aria-hidden className="mx-auto mb-3 h-1 w-9 rounded-full bg-border2" />
            {rest.map((link) => {
              const Icon = NAV_ICONS[link.icon];
              return (
                <Link
                  key={link.id}
                  href={link.href}
                  onClick={() => setMoreOpen(false)}
                  className={cn(
                    "flex h-11 items-center gap-3 rounded-lg px-2 font-medium",
                    isActive(pathname, link.href) && "text-accent",
                  )}
                >
                  <Icon aria-hidden className="size-[18px] text-muted" />
                  <span className="flex-1">{link.label}</span>
                  <ChevronRight aria-hidden className="size-4 text-faint" />
                </Link>
              );
            })}
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
