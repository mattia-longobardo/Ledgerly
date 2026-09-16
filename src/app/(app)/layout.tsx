import { cookies, headers } from "next/headers";
import { getTranslations } from "next-intl/server";
import { searchPayeesAction } from "@/modules/transactions/actions";
import { saveTheme } from "@/modules/users/actions";
import { hasSsoAccount } from "@/platform/auth/accounts";
import { getAuth } from "@/platform/auth/auth";
import { requireSession } from "@/platform/auth/session";
import { CommandPalette } from "@/ui/shell/command-palette";
import { MobileNav } from "@/ui/shell/mobile-nav";
import type { NavLink } from "@/ui/shell/nav-types";
import { ShellProvider } from "@/ui/shell/shell-context";
import { parseSidebar, SIDEBAR_COOKIE } from "@/ui/shell/sidebar-state";
import { Sidebar } from "@/ui/shell/sidebar";
import { Toaster } from "@/ui/toast";
import { navFor } from "./navigation";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const ctx = await requireSession();
  const session = await getAuth().api.getSession({ headers: await headers() });
  const viaSso = await hasSsoAccount(ctx.userId);
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
    themeSaveError: t("shell.themeSaveError"),
    signOut: t("shell.signOut"),
    profile: t("shell.profile"),
    more: t("nav.more"),
    palette: {
      placeholder: t("shell.palette.placeholder"),
      pages: t("shell.palette.pages"),
      payees: t("expenses.palette.payees"),
      empty: t("shell.palette.empty"),
      shortcut: t("shell.palette.shortcut"),
      escape: t("shell.palette.escape"),
    },
  };
  const sidebar = parseSidebar((await cookies()).get(SIDEBAR_COOKIE)?.value);
  const user = {
    name: session?.user.name ?? "",
    via: t(viaSso ? "shell.via.authentik" : "shell.via.password"),
  };

  return (
    <ShellProvider initialSidebar={sidebar} labels={labels} saveTheme={saveTheme}>
      <div className="flex h-dvh overflow-hidden">
        <Sidebar links={links} user={user} />
        <div className="flex min-w-0 flex-1 flex-col overflow-y-auto">{children}</div>
      </div>
      <MobileNav links={links} user={user} />
      <CommandPalette links={links} searchPayees={searchPayeesAction} />
      <Toaster closeLabel={t("common.close")} />
    </ShellProvider>
  );
}
