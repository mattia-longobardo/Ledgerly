import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Route } from "next";
import { describe, expect, it, vi } from "vitest";
import type { NavLink } from "./nav-types";
import { ShellProvider } from "./shell-context";
import { MobileNav } from "./mobile-nav";

vi.mock("next/navigation", () => ({ usePathname: () => "/settings/profile" }));

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
  product: "Finance Dashboard",
  primary: "Primary",
  groups: { finance: "Finance", work: "Work", system: "System" },
  toggleSidebar: "Toggle sidebar",
  search: "Search or jump to…",
  toggleTheme: "Toggle theme",
  themeSaveError: "Couldn't save your theme. Try again.",
  signOut: "Sign out",
  more: "More",
  palette: {
    placeholder: "Jump to a page…",
    pages: "Pages",
    empty: "No matches",
    shortcut: "⌘K",
    escape: "esc",
  },
};

describe("MobileNav", () => {
  it("marks the current page inside the More sheet, and leaves other items unmarked", async () => {
    render(
      <ShellProvider initialCollapsed={false} labels={LABELS}>
        <MobileNav links={LINKS} />
      </ShellProvider>,
    );

    await userEvent.click(screen.getByRole("button", { name: LABELS.more }));

    expect(screen.getByRole("link", { name: /Settings/ })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: /Components/ })).not.toHaveAttribute("aria-current");
  });
});
