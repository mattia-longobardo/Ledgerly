import type { ReactNode } from "react";
import Link from "next/link";
import { AppShell } from "@/components/layout/AppShell";
import { requireUserOrRedirect } from "@/lib/auth/require-user";

/**
 * Every page in this group renders from Postgres on the server. The auth check
 * lives here AND in each page's data path: `proxy.ts` is defence in depth only
 * (CVE-2025-29927), never the gate.
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  await requireUserOrRedirect();

  return (
    <AppShell
      sidebarFooter={
        <Link
          href="/settings"
          aria-label="Settings"
          className="inline-flex size-11 items-center justify-center rounded-md border border-border bg-surface text-fg-muted"
        >
          <svg
            aria-hidden
            viewBox="0 0 20 20"
            width={18}
            height={18}
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx={10} cy={10} r={2.75} />
            <path d="M10 2.5v1.75M10 15.75v1.75M2.5 10h1.75M15.75 10h1.75M4.7 4.7l1.24 1.24M14.06 14.06l1.24 1.24M15.3 4.7l-1.24 1.24M5.94 14.06 4.7 15.3" />
          </svg>
        </Link>
      }
    >
      {children}
    </AppShell>
  );
}
