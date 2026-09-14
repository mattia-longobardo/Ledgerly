import type { Route } from "next";
import type { ReactNode } from "react";
import { ThemeToggle } from "./theme-toggle";
import { Topbar } from "./topbar";

/** Every signed-in page: the topbar (breadcrumb + actions) and the 1440 px content column. */
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
      <main className="mx-auto flex w-full max-w-[1440px] animate-in flex-col gap-4 p-6 max-md:p-4 max-md:pb-24">
        {children}
      </main>
    </div>
  );
}
