import type { Route } from "next";
import type { Role } from "@ledgerly/domain/platform/context";
import type { NavLink } from "@ledgerly/ui/shell/nav-types";

interface NavItem extends Omit<NavLink, "label"> {
  labelKey:
    | "overview"
    | "accounts"
    | "expenses"
    | "budgets"
    | "funds"
    | "investments"
    | "interests"
    | "pockets"
    | "subscriptions"
    | "payroll"
    | "timeoff"
    | "settings";
  adminOnly: boolean;
}

/** The single navigation list: sidebar, mobile tabs and command palette all derive from it. */
const NAV_ITEMS: readonly NavItem[] = [
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
    id: "investments",
    href: "/investments" as Route,
    labelKey: "investments",
    icon: "investments",
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

type SettingsTabId =
  "profile" | "security" | "integrations" | "categories" | "rules" | "data" | "users" | "server";

interface SettingsTab {
  id: SettingsTabId;
  href: Route;
  /** Admin › Users and Admin › Server (spec §7.10): their pages answer 404 to anyone else. */
  adminOnly: boolean;
  /** Found by ⌘K. Rules never was: a product choice this list keeps, not one it makes. */
  inPalette: boolean;
}

/** The single list of the pages of Settings (audit UI-NAV-2): the tabs and the palette derive from it. */
const SETTINGS_TABS: readonly SettingsTab[] = [
  { id: "profile", href: "/settings/profile", adminOnly: false, inPalette: true },
  { id: "security", href: "/settings/security", adminOnly: false, inPalette: true },
  { id: "integrations", href: "/settings/integrations", adminOnly: false, inPalette: true },
  { id: "categories", href: "/settings/categories", adminOnly: false, inPalette: true },
  { id: "rules", href: "/settings/rules", adminOnly: false, inPalette: false },
  { id: "data", href: "/settings/data", adminOnly: false, inPalette: true },
  { id: "users", href: "/settings/users", adminOnly: true, inPalette: true },
  { id: "server", href: "/settings/server", adminOnly: true, inPalette: true },
];

export function settingsTabsFor(role: Role): SettingsTab[] {
  return SETTINGS_TABS.filter((tab) => !tab.adminOnly || role === "admin");
}
