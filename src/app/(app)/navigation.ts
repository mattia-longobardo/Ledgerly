import type { Route } from "next";
import type { Role } from "@/platform/context";
import type { NavLink } from "@/ui/shell/nav-types";

export interface NavItem extends Omit<NavLink, "label"> {
  labelKey:
    | "overview"
    | "accounts"
    | "expenses"
    | "budgets"
    | "funds"
    | "interests"
    | "pockets"
    | "subscriptions"
    | "payroll"
    | "timeoff"
    | "settings";
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
    id: "budgets",
    href: "/budgets" as Route,
    labelKey: "budgets",
    icon: "budgets",
    group: "finance",
    mobile: false,
    adminOnly: false,
  },
  {
    id: "funds",
    href: "/funds" as Route,
    labelKey: "funds",
    icon: "funds",
    group: "finance",
    mobile: false,
    adminOnly: false,
  },
  {
    id: "interests",
    href: "/interests" as Route,
    labelKey: "interests",
    icon: "interests",
    group: "finance",
    mobile: false,
    adminOnly: false,
  },
  {
    id: "pockets",
    href: "/pockets" as Route,
    labelKey: "pockets",
    icon: "pockets",
    group: "finance",
    mobile: false,
    adminOnly: false,
  },
  {
    id: "subscriptions",
    href: "/subscriptions" as Route,
    labelKey: "subscriptions",
    icon: "subscriptions",
    group: "finance",
    mobile: false,
    adminOnly: false,
  },
  {
    id: "payroll",
    href: "/payroll" as Route,
    labelKey: "payroll",
    icon: "payroll",
    group: "work",
    mobile: true,
    adminOnly: false,
  },
  {
    id: "timeoff",
    href: "/timeoff" as Route,
    labelKey: "timeoff",
    icon: "timeoff",
    group: "work",
    // Not a tab: the bar's fifth cell is More, and a fifth tab pushed it into a clipped row.
    mobile: false,
    adminOnly: false,
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
