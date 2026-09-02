import type { ReactNode } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { requirePrincipalOrRedirect } from "@/platform/auth/require-principal";
import { buildNavigation } from "@/platform/capabilities/navigation";
import { realProbes } from "@/platform/capabilities/probes";
import { resolveCapabilities } from "@/platform/capabilities/resolve";

/**
 * Every page in this group renders from Postgres on the server. The auth check
 * lives here AND in each page's data path: `proxy.ts` is defence in depth only
 * (CVE-2025-29927), never the gate.
 *
 * The *redirecting* variant is deliberate. The App Router does not route a
 * layout's own error into that segment's `error.tsx`, so a throw here would
 * escape to the bare framework error page instead of the sign-in redirect a
 * signed-out visitor expects. It subsumes `requireUserOrRedirect()`, which this
 * layout used to call separately — one session read now instead of two.
 *
 * Navigation is resolved here, on the server, because what the shell should
 * offer depends on what this deployment is wired to and what the signed-in
 * principal may do — neither of which the client knows.
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const principal = await requirePrincipalOrRedirect();
  const caps = await resolveCapabilities(principal, realProbes);

  return <AppShell items={buildNavigation(caps)}>{children}</AppShell>;
}
