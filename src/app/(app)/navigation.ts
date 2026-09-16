import type { Route } from "next";
import type { Role } from "@/platform/context";
import type { NavLink } from "@/ui/shell/nav-types";

export interface NavItem extends Omit<NavLink, "label"> {
  labelKey: "overview" | "accounts" | "expenses" | "settings" | "components";
  adminOnly: boolean;
}

/** The single navigation list: sidebar, mobile tabs and command palette all derive from it. */
export const NAV_ITEMS: readonly NavItem[] = [
  {
    id: "overview",
    href: "/" as Route,
    labelKey: "overview",
    icon: "overview",
    group: "finance",
    mobile: true,
    adminOnly: false,
  },
  {
    id: "accounts",
    href: "/accounts" as Route,
    labelKey: "accounts",
    icon: "accounts",
    group: "finance",
    mobile: true,
    adminOnly: false,
  },
  {
    id: "expenses",
    href: "/expenses" as Route,
    labelKey: "expenses",
    icon: "expenses",
    group: "finance",
    mobile: true,
    adminOnly: false,
  },
  {
    id: "components",
    href: "/components" as Route,
    labelKey: "components",
    icon: "components",
    group: "system",
    mobile: false,
    adminOnly: true,
  },
  {
    id: "settings",
    href: "/settings/profile" as Route,
    labelKey: "settings",
    icon: "settings",
    group: "footer",
    mobile: false,
    adminOnly: false,
  },
];

export function navFor(role: Role): NavItem[] {
  return NAV_ITEMS.filter((item) => !item.adminOnly || role === "admin");
}
