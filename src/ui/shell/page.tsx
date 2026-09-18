import type { Route } from "next";
import type { ReactNode } from "react";
import { ThemeToggle } from "./theme-toggle";
import { Topbar } from "./topbar";

/**
 * Every signed-in page: the topbar (breadcrumb + actions) and the content column — 1920 px at most
 * since F2.5 (it was 1440, which left a third of a 2560 px screen empty). The column is a size
 * container, so the pages' grids answer to the width it really has, sidebar open or shut, and not to
 * the window's (spec §8.2).
 */
export function Page({
  title,
  parent,
  actions,
  children,
}: {
  title: ReactNode;
  parent?: { href: Route; label: string };
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <Topbar title={title} parent={parent} actions={actions} themeToggle={<ThemeToggle />} />
      <main className="@container mx-auto flex w-full max-w-[1920px] animate-in flex-col gap-4 p-6 max-md:p-4 max-md:pb-24">
        {children}
      </main>
    </div>
  );
}
