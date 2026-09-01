"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode, SVGProps } from "react";
import { ThemeToggle } from "../ThemeToggle";
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
 * One level of navigation only: a 56 px bottom tab bar on mobile, a slim left
 * sidebar from 1024 px up. Never both, never nested.
 */
export function AppShell({ children, sidebarFooter }: AppShellProps) {
  const pathname = usePathname() ?? "/";

  return (
    <div className="min-h-dvh bg-bg lg:pl-52">
      <nav
        aria-label="Sections"
        className="fixed inset-y-0 left-0 z-30 hidden w-52 flex-col border-r border-border bg-surface px-3 py-4 lg:flex"
      >
        <span className="px-2 pb-4 text-caption tracking-widest text-fg-muted uppercase">
          Dashboard
        </span>
        <ul className="flex flex-col gap-1">
          {TABS.map((tab) => {
            const active = isActive(pathname, tab.href);
            return (
              <li key={tab.href}>
                <Link
                  href={tab.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex min-h-11 items-center gap-3 rounded-md px-3 text-body transition-colors duration-150 ease-out",
                    active ? "bg-surface-raised text-accent" : "text-fg-muted",
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

      <div className="mx-auto w-full max-w-3xl pb-[calc(3.5rem+env(safe-area-inset-bottom,0px))] lg:max-w-4xl lg:pb-0">
        {children}
      </div>

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
