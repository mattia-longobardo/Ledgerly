"use client";

import { PanelLeft, Search } from "lucide-react";
import Link from "next/link";
import type { Route } from "next";
import type { ReactNode } from "react";
import { IconButton } from "@/ui/button";
import { cn } from "@/ui/cn";
import { Kbd } from "@/ui/kbd";
import { useShell } from "./shell-context";

const MOBILE_TITLE = "max-md:text-xl max-md:font-semibold max-md:tracking-[-0.01em]";

export function Topbar({
  title,
  parent,
  actions,
  themeToggle,
}: {
  title: ReactNode;
  parent?: { href: Route; label: string };
  actions?: ReactNode;
  themeToggle: ReactNode;
}) {
  const { toggleSidebar, setPaletteOpen, labels } = useShell();
  return (
    <header className="sticky top-0 z-20 flex h-12 shrink-0 items-center gap-2 border-b border-border bg-bg pr-5 pl-3 max-md:h-[52px] max-md:px-4">
      <IconButton label={labels.toggleSidebar} onClick={toggleSidebar} className="max-md:hidden">
        <PanelLeft aria-hidden className="size-4" />
      </IconButton>
      <div className="flex min-w-0 items-center gap-1.5 text-muted">
        {parent && (
          <>
            <Link href={parent.href} className="focus-ring rounded-[4px] hover:text-fg max-md:hidden">
              {parent.label}
            </Link>
            <span aria-hidden className="text-faint max-md:hidden">
              /
            </span>
          </>
        )}
        <span className={cn("truncate font-medium text-fg", parent ? "max-md:hidden" : MOBILE_TITLE)}>
          {title}
        </span>
        {/* Phones show one title, the section's (as the design's mobile header does). */}
        {parent && <span className={cn("truncate text-fg md:hidden", MOBILE_TITLE)}>{parent.label}</span>}
      </div>
      <div className="flex-1" />
      <button
        type="button"
        onClick={() => setPaletteOpen(true)}
        className="focus-ring flex h-7 w-[220px] items-center gap-2 rounded-ctl border border-border bg-card pr-2 pl-2.5 text-sm text-muted max-md:hidden"
      >
        <Search aria-hidden className="size-3.5" />
        <span className="flex-1 text-left">{labels.search}</span>
        <Kbd>{labels.palette.shortcut}</Kbd>
      </button>
      <IconButton
        label={labels.search}
        bordered
        size={32}
        onClick={() => setPaletteOpen(true)}
        className="md:hidden"
      >
        <Search aria-hidden className="size-4" />
      </IconButton>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
      <span aria-hidden className="mx-1 h-5 w-px bg-border max-md:hidden" />
      <span className="max-md:hidden">{themeToggle}</span>
    </header>
  );
}
