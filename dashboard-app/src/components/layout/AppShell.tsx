"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode, SVGProps } from "react";
import { ThemeToggle } from "../ThemeToggle";
import { BrandLockup } from "../ui/Brand";
import { cn } from "../ui/cn";

type IconProps = SVGProps<SVGSVGElement>;

function Icon({ children, ...rest }: IconProps & { children: ReactNode }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      width={22}
      height={22}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...rest}
    >
      {children}
    </svg>
  );
}

const TABS = [
  {
    href: "/",
    label: "Home",
    icon: (
      <Icon>
        <path d="M3.5 10.5 12 3.5l8.5 7M5.5 9.5v10h13v-10" />
      </Icon>
    ),
  },
  {
    href: "/finance",
    label: "Finance",
    icon: (
      <Icon>
        <path d="M3.5 19.5h17M6 16V9.5M11 16V5.5M16 16v-4M20 16v-7" />
      </Icon>
    ),
  },
  {
    href: "/work",
    label: "Work",
    icon: (
      <Icon>
        <rect x={3} y={7} width={18} height={12.5} rx={2} />
        <path d="M9 7V5.5a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 15 5.5V7" />
      </Icon>
    ),
  },
] as const;

function isActive(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

export interface AppShellProps {
  children: ReactNode;
  /** Rendered at the foot of the desktop sidebar, beside the theme toggle. */
  sidebarFooter?: ReactNode;
}

/**
 * One level of navigation only: a 56 px bottom tab bar on mobile, a 240 px left
 * sidebar from 1024 px up. Never both, never nested.
 *
 * The content column is fluid. It was capped at 896 px, a prose reading width,
 * which is right for an article and wrong for an instrument panel: at 1920 that
 * left 48 % of the usable area empty.
 *
 * The only cap left is 2100 px. It is a stop against a single row of figures
 * running the width of an ultrawide, not a column: reading width is held by
 * `max-w-prose` on the prose blocks that need it, which is where the constraint
 * actually belongs. 2100 is the widest cap that still keeps unused space under
 * 12 % at 2560, the acceptance number this redesign was measured against.
 */
export function AppShell({ children, sidebarFooter }: AppShellProps) {
  const pathname = usePathname() ?? "/";

  return (
    <div className="min-h-dvh bg-bg lg:pl-60">
      {/* First tab stop on every route: keyboard users skip the sidebar. */}
      <a
        href="#main"
        className="sr-only z-50 focus-visible:not-sr-only focus-visible:fixed focus-visible:top-3 focus-visible:left-3 focus-visible:inline-flex focus-visible:min-h-11 focus-visible:items-center focus-visible:rounded-md focus-visible:bg-accent focus-visible:px-4 focus-visible:text-body-sm focus-visible:font-medium focus-visible:text-accent-contrast"
      >
        Skip to content
      </a>

      <nav
        aria-label="Main"
        className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col overflow-y-auto overscroll-contain border-r border-border bg-surface px-3 py-4 lg:flex"
      >
        <BrandLockup className="axis-rule mx-2 pb-4 [--axis-bleed:0.75rem]" />
        <ul className="mt-4 flex flex-col gap-0.5">
          {TABS.map((tab) => {
            const active = isActive(pathname, tab.href);
            return (
              <li key={tab.href}>
                <Link
                  href={tab.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "relative flex min-h-11 items-center gap-3 rounded-md px-3 text-body transition-colors duration-150 ease-out",
                    "before:absolute before:top-2 before:bottom-2 before:-left-3 before:w-0.5 before:rounded-xs before:bg-accent before:transition-opacity",
                    active
                      ? "bg-surface-raised text-accent before:opacity-100"
                      : "text-fg-muted before:opacity-0 hover:bg-surface-hover hover:text-fg",
                  )}
                >
                  {tab.icon}
                  <span className={active ? "font-medium" : undefined}>{tab.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
        <div className="mt-auto flex items-center gap-2 pt-4">
          <ThemeToggle />
          {sidebarFooter}
        </div>
      </nav>

      {/*
        The gutter lives here and nowhere else, so `--axis-bleed` can track it:
        an axis rule always reaches the edge of the box that owns it, at every
        width, without a single page knowing what the current padding is.

        This is also the app's one `<main>`, so there is exactly one main
        landmark per route and the skip link always has somewhere to land.
      */}
      <main
        id="main"
        tabIndex={-1}
        className="mx-auto w-full max-w-[2100px] px-4 pb-[calc(4.5rem+env(safe-area-inset-bottom,0px))] [--axis-bleed:1rem] outline-none lg:px-6 lg:pb-10 lg:[--axis-bleed:1.5rem] xl:px-8 xl:[--axis-bleed:2rem]"
      >
        {children}
      </main>

      <nav
        aria-label="Sections"
        className="safe-b fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface lg:hidden"
      >
        <ul className="flex h-14 items-stretch">
          {TABS.map((tab) => {
            const active = isActive(pathname, tab.href);
            return (
              <li key={tab.href} className="flex-1">
                <Link
                  href={tab.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "relative flex h-full flex-col items-center justify-center gap-0.5",
                    active ? "text-accent" : "text-fg-muted",
                  )}
                >
                  {active && (
                    <span aria-hidden className="absolute inset-x-6 top-0 h-0.5 rounded-xs bg-accent" />
                  )}
                  {tab.icon}
                  <span className={cn("text-caption", active && "font-medium")}>{tab.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}
