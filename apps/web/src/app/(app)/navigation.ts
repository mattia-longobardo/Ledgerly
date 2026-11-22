import type { Route } from "next";
import type { Role } from "@ledgerly/domain/platform/context";
import type { NavLink } from "@ledgerly/ui/shell/nav-types";

/**
 * The addons of the plan (13-plugins-addons.md §13.3): the parts of the product a person can turn off.
 * shortcut: a copy of the list until step a of R5a puts `AddonId` in `packages/domain`; then import it.
 */
export type Addon =
  "investments" | "funds" | "payroll" | "timeoff" | "budgets" | "subscriptions" | "pockets" | "interests";

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
  /** The addon the item belongs to; `null` for a base module, which is never off (PA9). */
  addon: Addon | null;
}

/** The tabs of the phone (decision D2d); the bar's fifth cell is More. */
const MOBILE_TABS: readonly string[] = ["overview", "accounts", "expenses", "investments"];

const item = (
  id: NavItem["labelKey"],
  href: string,
  group: NavItem["group"],
  addon: Addon | null,
): NavItem => ({
  id,
  href: href as Route,
  labelKey: id,
  icon: id,
  group,
  mobile: MOBILE_TABS.includes(id),
  adminOnly: false,
  addon,
});

/** The single navigation list: sidebar, mobile tabs and command palette all derive from it (groups: D2). */
const NAV_ITEMS: readonly NavItem[] = [
  item("overview", "/", "everyday", null),
  item("accounts", "/accounts", "everyday", null),
  item("expenses", "/expenses", "everyday", null),
  item("budgets", "/budgets", "everyday", "budgets"),
  item("subscriptions", "/subscriptions", "everyday", "subscriptions"),
  item("investments", "/investments", "savings", "investments"),
  item("funds", "/funds", "savings", "funds"),
  item("pockets", "/pockets", "savings", "pockets"),
  item("interests", "/interests", "savings", "interests"),
  item("payroll", "/payroll", "work", "payroll"),
  item("timeoff", "/timeoff", "work", "timeoff"),
  item("settings", "/settings/profile", "footer", null),
];

/**
 * The one place where the menu leaves out what the person has turned off (PA10). `addons` is the
 * session's list once step a of R5a gives it; until then every addon is on, as for every person today.
 */
export function isOn(addon: Addon | null, addons?: readonly Addon[]): boolean {
  return addon === null || addons === undefined || addons.includes(addon);
}

export function navFor(role: Role, addons?: readonly Addon[]): NavItem[] {
  return NAV_ITEMS.filter((entry) => (!entry.adminOnly || role === "admin") && isOn(entry.addon, addons));
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
