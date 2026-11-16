import type { getTranslations } from "next-intl/server";
import { describe, expect, it } from "vitest";
import { paletteCommands } from "./palette-commands";

/** A translator that answers with the key: the list is what is held here, not the words. */
const t = ((key: string) => key) as unknown as Awaited<ReturnType<typeof getTranslations<never>>>;

describe("paletteCommands", () => {
  it("lists every settings page a user has, then the commands of the modules", () => {
    expect(paletteCommands("user", t).map((one) => [one.id, one.href])).toEqual([
      ["settings-profile", "/settings/profile"],
      ["settings-security", "/settings/security"],
      ["settings-integrations", "/settings/integrations"],
      ["settings-categories", "/settings/categories"],
      ["settings-data", "/settings/data"],
      ["to-review", "/expenses/review"],
      ["add-transaction", "/expenses?add=1"],
      ["timeoff-settings", "/timeoff/settings"],
      ["payroll-settings", "/payroll/settings"],
    ]);
  });

  it("adds the admin's pages after the ones of everybody", () => {
    expect(
      paletteCommands("admin", t)
        .map((one) => one.id)
        .slice(4, 7),
    ).toEqual(["settings-data", "settings-users", "settings-server"]);
  });

  it("names a settings page by its section, and gives a command the icon of its module", () => {
    const commands = paletteCommands("user", t);
    expect(commands[0]).toEqual({
      id: "settings-profile",
      href: "/settings/profile",
      icon: "settings",
      group: "footer",
      mobile: false,
      label: "settings.title › settings.tabs.profile",
    });
    expect(commands.find((one) => one.id === "to-review")).toMatchObject({
      icon: "expenses",
      label: "expenses.review.palette",
    });
  });
});
