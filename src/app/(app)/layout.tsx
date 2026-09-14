import { cookies, headers } from "next/headers";
import { getTranslations } from "next-intl/server";
import { getAuth } from "@/platform/auth/auth";
import { OIDC_PROVIDER_ID } from "@/platform/auth/provider";
import { requireSession } from "@/platform/auth/session";
import { CommandPalette } from "@/ui/shell/command-palette";
import { MobileNav } from "@/ui/shell/mobile-nav";
import type { NavLink } from "@/ui/shell/nav-types";
import { ShellProvider, SIDEBAR_COOKIE } from "@/ui/shell/shell-context";
import { Sidebar } from "@/ui/shell/sidebar";
import { Toaster } from "@/ui/toast";
import { navFor } from "./navigation";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const ctx = await requireSession();
  const session = await getAuth().api.getSession({ headers: await headers() });
  const accounts = await getAuth().api.listUserAccounts({ headers: await headers() });
  const viaSso = accounts.some((account) => account.providerId === OIDC_PROVIDER_ID);
  const t = await getTranslations();

  const links: NavLink[] = navFor(ctx.role).map(({ id, href, icon, group, mobile, labelKey }) => ({
    id,
    href,
    icon,
    group,
    mobile,
    label: t(`nav.${labelKey}`),
  }));
  const labels = {
    product: t("common.product"),
    primary: t("nav.primary"),
    groups: { finance: t("nav.groups.finance"), work: t("nav.groups.work"), system: t("nav.groups.system") },
    toggleSidebar: t("shell.toggleSidebar"),
    search: t("shell.search"),
    toggleTheme: t("shell.toggleTheme"),
    signOut: t("shell.signOut"),
    more: t("nav.more"),
    palette: {
      placeholder: t("shell.palette.placeholder"),
      pages: t("shell.palette.pages"),
      empty: t("shell.palette.empty"),
      shortcut: t("shell.palette.shortcut"),
      escape: t("shell.palette.escape"),
    },
  };
  const collapsed = (await cookies()).get(SIDEBAR_COOKIE)?.value === "collapsed";

  return (
    <ShellProvider initialCollapsed={collapsed} labels={labels}>
      <div className="flex h-dvh overflow-hidden">
        <Sidebar
          links={links}
          user={{
            name: session?.user.name ?? "",
            via: t(viaSso ? "shell.via.authentik" : "shell.via.password"),
          }}
        />
        <div className="flex min-w-0 flex-1 flex-col overflow-y-auto">{children}</div>
      </div>
      <MobileNav links={links} />
      <CommandPalette links={links} />
      <Toaster closeLabel={t("common.close")} />
    </ShellProvider>
  );
}
