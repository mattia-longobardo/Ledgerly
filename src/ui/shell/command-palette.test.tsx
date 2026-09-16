import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Route } from "next";
import { describe, expect, it, vi } from "vitest";
import { CommandPalette } from "./command-palette";
import type { NavLink } from "./nav-types";
import { ShellProvider } from "./shell-context";

vi.mock("next/navigation", () => ({ usePathname: () => "/", useRouter: () => ({ push: vi.fn() }) }));

// "/components" and "/settings/profile" are not yet real routes (Tasks 18-19 add their pages).
const LINKS: NavLink[] = [
  { id: "overview", href: "/", label: "Overview", icon: "overview", group: "finance", mobile: true },
  {
    id: "components",
    href: "/components" as Route,
    label: "Components",
    icon: "components",
    group: "system",
    mobile: false,
  },
  {
    id: "settings",
    href: "/settings/profile" as Route,
    label: "Settings",
    icon: "settings",
    group: "footer",
    mobile: false,
  },
];

const LABELS = {
  product: "Ledgerly",
  primary: "Primary",
  groups: { finance: "Finance", work: "Work", system: "System" },
  toggleSidebar: "Toggle sidebar",
  search: "Search or jump to…",
  toggleTheme: "Toggle theme",
  themeSaveError: "Couldn't save your theme. Try again.",
  signOut: "Sign out",
  profile: "Profile and preferences",
  more: "More",
  palette: {
    placeholder: "Jump to a page…",
    pages: "Pages",
    empty: "No matches",
    shortcut: "⌘K",
    escape: "esc",
  },
};

describe("CommandPalette", () => {
  it("moves aria-activedescendant and aria-selected as ArrowDown moves the cursor", async () => {
    render(
      <ShellProvider initialSidebar="expanded" labels={LABELS} saveTheme={async () => undefined}>
        <CommandPalette links={LINKS} />
      </ShellProvider>,
    );

    await userEvent.keyboard("{Meta>}k{/Meta}");
    const input = await screen.findByPlaceholderText("Jump to a page…");
    expect(input).toHaveAttribute("role", "combobox");
    expect(input).toHaveAttribute("aria-expanded", "true");

    const options = screen.getAllByRole("option");
    expect(options).toHaveLength(3);
    expect(input.getAttribute("aria-activedescendant")).toBe(options[0].id);
    expect(options[0]).toHaveAttribute("aria-selected", "true");
    expect(options[1]).toHaveAttribute("aria-selected", "false");

    await userEvent.type(input, "{ArrowDown}");

    expect(input.getAttribute("aria-activedescendant")).toBe(options[1].id);
    expect(options[0]).toHaveAttribute("aria-selected", "false");
    expect(options[1]).toHaveAttribute("aria-selected", "true");
  });
});
