import type { Route } from "next";
import type { AddonId } from "@ledgerly/api-contract";
import { addonOn, type Role } from "@ledgerly/domain/platform/context";
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
  /** The addon the item belongs to; `null` for a base module, which is never off (PA9). */
  addon: AddonId | null;
}

/** The tabs of the phone (decision D2d); the bar's fifth cell is More. */
const MOBILE_TABS: readonly string[] = ["overview", "accounts", "expenses", "investments"];

const item = (
  id: NavItem["labelKey"],
  href: string,
  group: NavItem["group"],
  addon: AddonId | null,
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
 * The one place where the menu and the palette leave out what the person has turned off (PA10):
 * `addons` is the session's list; absent, every addon is on.
 */
export function isOn(addon: AddonId | null, addons?: readonly AddonId[]): boolean {
  return addon === null || addonOn({ addons }, addon);
}

export function navFor(role: Role, addons?: readonly AddonId[]): NavItem[] {
  return NAV_ITEMS.filter((entry) => (!entry.adminOnly || role === "admin") && isOn(entry.addon, addons));
}

type SettingsTabId =
  "profile" | "security" | "finance" | "plugins" | "addons" | "notifications" | "data" | "users" | "server";

interface SettingsTab {
  id: SettingsTabId;
  href: Route;
  /** Admin › Users and Admin › Server (spec §7.10): their pages answer 404 to anyone else. */
  adminOnly: boolean;
}

/**
 * The single list of the pages of Settings (audit UI-NAV-2): the tabs and the palette derive from it.
 * Finance and Plugins are decision D3's; Rules is a page of Finance. Addons is PA16's, Alerts R5e's.
 */
const SETTINGS_TABS: readonly SettingsTab[] = [
  { id: "profile", href: "/settings/profile", adminOnly: false },
  { id: "security", href: "/settings/security", adminOnly: false },
  { id: "finance", href: "/settings/finance", adminOnly: false },
  { id: "plugins", href: "/settings/plugins", adminOnly: false },
  { id: "addons", href: "/settings/addons", adminOnly: false },
  { id: "notifications", href: "/settings/notifications", adminOnly: false },
  { id: "data", href: "/settings/data", adminOnly: false },
  { id: "users", href: "/settings/users", adminOnly: true },
  { id: "server", href: "/settings/server", adminOnly: true },
];

export function settingsTabsFor(role: Role): SettingsTab[] {
  return SETTINGS_TABS.filter((tab) => !tab.adminOnly || role === "admin");
}
