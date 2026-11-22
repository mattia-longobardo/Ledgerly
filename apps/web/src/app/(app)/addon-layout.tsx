import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import type { AddonId } from "@ledgerly/api-contract";
import { requireSession } from "@/platform/auth/session";
import { isOn } from "./navigation";

/**
 * The layout of an addon's pages (PA10): while the addon is off, a direct address leads to Settings ›
 * Addons, which says why and offers the switch. The API refuses the module's routes all the same.
 */
export function addonLayout(addon: AddonId) {
  return async function AddonLayout({ children }: { children: ReactNode }) {
    const ctx = await requireSession();
    if (!isOn(addon, ctx.addons)) redirect(`/settings/addons?off=${addon}`);
    return children;
  };
}
