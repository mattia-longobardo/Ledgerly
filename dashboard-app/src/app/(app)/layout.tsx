import type { ReactNode } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { requireUserOrRedirect } from "@/lib/auth/require-user";
import { requirePrincipal } from "@/platform/auth/require-principal";
import { buildNavigation } from "@/platform/capabilities/navigation";
import { realProbes } from "@/platform/capabilities/probes";
import { resolveCapabilities } from "@/platform/capabilities/resolve";

/**
 * Every page in this group renders from Postgres on the server. The auth check
 * lives here AND in each page's data path: `proxy.ts` is defence in depth only
 * (CVE-2025-29927), never the gate.
 *
 * Navigation is resolved here, on the server, because what the shell should
 * offer depends on what this deployment is wired to and what the signed-in
 * principal may do — neither of which the client knows.
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  await requireUserOrRedirect();
  const principal = await requirePrincipal();
  const caps = await resolveCapabilities(principal, realProbes);

  return <AppShell items={buildNavigation(caps)}>{children}</AppShell>;
}
