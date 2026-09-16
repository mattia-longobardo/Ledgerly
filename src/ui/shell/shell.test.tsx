import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Route } from "next";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isActive } from "./active";
import { CommandPalette } from "./command-palette";
import { filterCommands } from "./commands";
import type { NavLink } from "./nav-types";
import { ShellProvider } from "./shell-context";
import type { SidebarState } from "./sidebar-state";
import { Sidebar } from "./sidebar";
import { Topbar } from "./topbar";

const push = vi.fn();
vi.mock("next/navigation", () => ({ usePathname: () => "/settings/profile", useRouter: () => ({ push }) }));

// "/components" and "/settings/profile" are not yet real routes (Tasks 18-19 add their pages), so
// typed routes only accept them through the cast — same pattern as `sidebar.tsx`'s `/sign-in` push.
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

function renderShell(sidebar: SidebarState = "expanded") {
  return render(
    <ShellProvider initialSidebar={sidebar} labels={LABELS} saveTheme={async () => undefined}>
      <Sidebar links={LINKS} user={{ name: "Mattia Longobardo", via: "via Authentik" }} />
      <CommandPalette links={LINKS} />
    </ShellProvider>,
  );
}

describe("shell", () => {
  beforeEach(() => push.mockReset());
  afterEach(() => vi.unstubAllGlobals());

  it("matches active routes by prefix, the root exactly", () => {
    expect(isActive("/", "/")).toBe(true);
    expect(isActive("/accounts", "/")).toBe(false);
    expect(isActive("/settings/profile", "/settings/profile")).toBe(true);
    expect(isActive("/accounts/123", "/accounts")).toBe(true);
    expect(isActive("/accountsx", "/accounts")).toBe(false);
  });

  it("filters commands by a case-insensitive substring", () => {
    expect(filterCommands(LINKS, "SET").map((l) => l.id)).toEqual(["settings"]);
    expect(filterCommands(LINKS, "").map((l) => l.id)).toEqual(["overview", "components", "settings"]);
  });

  it("marks the current page and collapses with ⌘\\", async () => {
    renderShell();
    expect(screen.getByRole("link", { name: "Settings" })).toHaveAttribute("aria-current", "page");
    const nav = screen.getByRole("navigation", { name: "Primary" });
    expect(nav).toHaveAttribute("data-sidebar", "expanded");
    await userEvent.keyboard("{Meta>}\\{/Meta}");
    expect(nav).toHaveAttribute("data-sidebar", "collapsed");
  });

  it("expands an icon-only sidebar below 1280 px, where it starts collapsed", async () => {
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: false, media: query }));
    renderShell("auto");
    const nav = screen.getByRole("navigation", { name: "Primary" });
    await userEvent.keyboard("{Meta>}\\{/Meta}");
    expect(nav).toHaveAttribute("data-sidebar", "expanded");
  });

  it("opens Profile from the user in the sidebar footer", () => {
    renderShell();
    expect(screen.getByRole("link", { name: /Mattia Longobardo/ })).toHaveAttribute(
      "href",
      "/settings/profile",
    );
  });

  it("shows the parent crumb and the page on desktop, and the section as the phone title", () => {
    render(
      <ShellProvider initialSidebar="expanded" labels={LABELS} saveTheme={async () => undefined}>
        <Topbar
          title="Profile"
          parent={{ href: "/settings/profile" as Route, label: "Settings" }}
          themeToggle={null}
        />
      </ShellProvider>,
    );
    const header = screen.getByRole("banner");
    expect(within(header).getByRole("link", { name: "Settings" })).toHaveClass("max-md:hidden");
    expect(within(header).getByText("Profile")).toHaveClass("max-md:hidden");
    expect(within(header).getByText("Settings", { selector: "span" })).toHaveClass("md:hidden");
  });

  it("reopens the palette empty after closing it with ⌘K", async () => {
    renderShell();
    await userEvent.keyboard("{Meta>}k{/Meta}");
    await userEvent.type(await screen.findByRole("combobox", { name: "Search or jump to…" }), "zzz");
    expect(screen.getByRole("status")).toHaveTextContent("No matches");
    await userEvent.keyboard("{Meta>}k{/Meta}");
    await userEvent.keyboard("{Meta>}k{/Meta}");
    expect(await screen.findByRole("combobox", { name: "Search or jump to…" })).toHaveValue("");
  });

  it("gives every palette row its group, Settings included", async () => {
    renderShell();
    await userEvent.keyboard("{Meta>}k{/Meta}");
    expect(await screen.findByRole("option", { name: /Settings/ })).toHaveTextContent("SettingsSystem");
  });

  it("opens the palette with ⌘K and jumps to the first match on Enter", async () => {
    renderShell();
    await userEvent.keyboard("{Meta>}k{/Meta}");
    const input = await screen.findByPlaceholderText("Jump to a page…");
    await userEvent.type(input, "comp{Enter}");
    expect(push).toHaveBeenCalledWith("/components");
  });
});
