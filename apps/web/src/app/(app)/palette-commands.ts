// src/app/(app)/palette-commands.ts — what the ⌘K palette finds beyond the sidebar: every settings
// page by name (PERS-158), and the commands of the modules. One list, like `navigation.ts`, and not
// lines of the common layout: a release that adds a command changes this file, which starts the
// tests of the shell, where a change to the layout starts the tests of every screen
// (docs/testing.md).
import type { Route } from "next";
import type { getTranslations } from "next-intl/server";
import type { Role } from "@ledgerly/domain/platform/context";
import type { NavLink } from "@ledgerly/ui/shell/nav-types";
import type { AddonId } from "@ledgerly/api-contract";
import { isOn, settingsTabsFor } from "./navigation";

/** The translator of the whole catalogue, as the layout has it: `getTranslations()` with no namespace. */
type Translator = Awaited<ReturnType<typeof getTranslations<never>>>;

const command = (id: string, href: string, label: string, icon: NavLink["icon"] = "settings"): NavLink => ({
  id,
  href: href as Route,
  icon,
  group: "footer",
  mobile: false,
  label,
});

/** The palette's own entries for a role, in the order the palette lists them. */
export function paletteCommands(role: Role, t: Translator, addons?: readonly AddonId[]): NavLink[] {
  const ofAddon = (addon: AddonId, entry: NavLink) => (isOn(addon, addons) ? [entry] : []);
  return [
    ...settingsTabsFor(role).map((tab) =>
      command(`settings-${tab.id}`, tab.href, `${t("settings.title")} › ${t(`settings.tabs.${tab.id}`)}`),
    ),
    // "To review", which has no place in the menu until the menu changes (R5a).
    command("to-review", "/expenses/review", t("expenses.review.palette"), "expenses"),
    // Expenses › Categories (categories-and-rules.md §5.1), the same until the menu changes.
    command(
      "categories",
      "/expenses/categories",
      `${t("expenses.title")} › ${t("expenses.categories.title")}`,
      "expenses",
    ),
    // The manual movement, as a command: the Expenses page opens its dialog (N3).
    command("add-transaction", "/expenses?add=1", t("expenses.manual.palette"), "expenses"),
    ...ofAddon(
      "timeoff",
      command(
        "timeoff-settings",
        "/timeoff/settings",
        `${t("timeoff.title")} › ${t("timeoff.tabs.settings")}`,
      ),
    ),
    ...ofAddon(
      "payroll",
      command(
        "payroll-settings",
        "/payroll/settings",
        `${t("payroll.title")} › ${t("payroll.tabs.settings")}`,
      ),
    ),
  ];
}
