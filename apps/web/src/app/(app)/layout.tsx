import { cookies } from "next/headers";
import { getTranslations } from "next-intl/server";
import { requirePreferences, requireSession } from "@/platform/auth/session";
import type { NavLink } from "@ledgerly/ui/shell/nav-types";
import { parseSidebar, SIDEBAR_COOKIE } from "@ledgerly/ui/shell/sidebar-state";
import { AppShell } from "./app-shell";
import { navFor } from "./navigation";
import { paletteCommands } from "./palette-commands";

/**
 * Every signed-in page. The layout keeps what only the server knows yet: the session's role (the
 * menu and the commands of the palette are a role's), the first day of the week (a context of the
 * server-drawn pages) and the sidebar's cookie; the shell reads the person and the palette's two
 * searches from `/api/v1`.
 */
export default async function AppLayout({ children }: LayoutProps<"/">) {
  const ctx = await requireSession();
  const [text, { weekStart, hideAmounts }] = await Promise.all([getTranslations(), requirePreferences()]);
  const links: NavLink[] = navFor(ctx.role, ctx.addons).map(
    ({ id, href, icon, group, mobile, labelKey }) => ({
      id,
      href,
      icon,
      group,
      mobile,
      label: text(`nav.${labelKey}`),
    }),
  );
  return (
    <AppShell
      initialSidebar={parseSidebar((await cookies()).get(SIDEBAR_COOKIE)?.value)}
      weekStart={weekStart}
      hideAmounts={hideAmounts}
      addons={ctx.addons}
      links={links}
      searchLinks={paletteCommands(ctx.role, text, ctx.addons)}
    >
      {/* Here and not in the root layout: the manifest is behind the session, so only a signed-in
        page may name it, and the browser has to send the cookie with the request (the comment of
        `src/app/manifest.webmanifest/route.ts`). React moves the element into `<head>`. */}
      <link rel="manifest" href="/manifest.webmanifest" crossOrigin="use-credentials" />
      {children}
    </AppShell>
  );
}
