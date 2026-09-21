import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Route } from "next";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CommandPalette } from "./command-palette";
import type { NavLink } from "./nav-types";
import { ShellProvider } from "./shell-context";

const push = vi.fn();
vi.mock("next/navigation", () => ({ usePathname: () => "/", useRouter: () => ({ push }) }));

// "/components" and "/settings/profile" are not yet real routes (Tasks 18-19 add their pages).
const LINKS: NavLink[] = [
  { id: "overview", href: "/", label: "Overview", icon: "overview", group: "finance", mobile: true },
  {
    id: "components",
    href: "/components" as Route,
    label: "Components",
    icon: "funds",
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
    records: "Pockets and subscriptions",
    payees: "Payees",
    empty: "No matches",
    shortcut: "⌘K",
    escape: "esc",
  },
};

describe("CommandPalette", () => {
  beforeEach(() => push.mockReset());

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

  it("offers the payees the search found, under their own heading, and opens them filtered", async () => {
    const searchPayees = vi.fn(async () => [{ payee: "Netflix", count: 7 }]);
    render(
      <ShellProvider initialSidebar="expanded" labels={LABELS} saveTheme={async () => undefined}>
        <CommandPalette links={LINKS} searchPayees={searchPayees} />
      </ShellProvider>,
    );

    await userEvent.keyboard("{Meta>}k{/Meta}");
    await userEvent.type(await screen.findByPlaceholderText("Jump to a page…"), "netfl");

    const payee = await screen.findByRole("option", { name: /Netflix/ });
    expect(searchPayees).toHaveBeenCalledWith("netfl");
    expect(payee).toHaveTextContent("7");
    expect(screen.getByText("Payees")).toBeInTheDocument();

    await userEvent.click(payee);
    expect(push).toHaveBeenCalledWith("/expenses?q=Netflix");
  });

  it("offers the pockets and subscriptions found by name, before the payees (spec §8.2)", async () => {
    const searchRecords = vi.fn(async () => [
      { id: "pocket:p-1", label: "Holidays", hint: "Pocket", href: "/pockets?pocket=p-1" as Route },
    ]);
    const searchPayees = vi.fn(async () => [{ payee: "Holiday Inn", count: 2 }]);
    render(
      <ShellProvider initialSidebar="expanded" labels={LABELS} saveTheme={async () => undefined}>
        <CommandPalette links={LINKS} searchPayees={searchPayees} searchRecords={searchRecords} />
      </ShellProvider>,
    );

    await userEvent.keyboard("{Meta>}k{/Meta}");
    await userEvent.type(await screen.findByPlaceholderText("Jump to a page…"), "holi");

    const pocket = await screen.findByRole("option", { name: /Holidays/ });
    expect(screen.getByText("Pockets and subscriptions")).toBeInTheDocument();
    const names = screen.getAllByRole("option").map((option) => option.textContent);
    expect(names.indexOf(pocket.textContent)).toBeLessThan(
      names.findIndex((name) => name?.includes("Holiday Inn")),
    );
    await userEvent.click(pocket);
    expect(push).toHaveBeenCalledWith("/pockets?pocket=p-1");
  });

  it("asks once for the settled query, not once per keystroke", async () => {
    const searchPayees = vi.fn(async () => []);
    render(
      <ShellProvider initialSidebar="expanded" labels={LABELS} saveTheme={async () => undefined}>
        <CommandPalette links={LINKS} searchPayees={searchPayees} />
      </ShellProvider>,
    );

    await userEvent.keyboard("{Meta>}k{/Meta}");
    await userEvent.type(await screen.findByPlaceholderText("Jump to a page…"), "netflix");

    await vi.waitFor(() => expect(searchPayees).toHaveBeenCalled());
    expect(searchPayees).toHaveBeenCalledTimes(1);
    expect(searchPayees).toHaveBeenCalledWith("netflix");
  });

  it("keeps navigating when the payee search fails", async () => {
    const searchPayees = vi.fn(async () => {
      throw new Error("offline");
    });
    render(
      <ShellProvider initialSidebar="expanded" labels={LABELS} saveTheme={async () => undefined}>
        <CommandPalette links={LINKS} searchPayees={searchPayees} />
      </ShellProvider>,
    );

    await userEvent.keyboard("{Meta>}k{/Meta}");
    const input = await screen.findByPlaceholderText("Jump to a page…");
    await userEvent.type(input, "comp");
    await vi.waitFor(() => expect(searchPayees).toHaveBeenCalled());

    expect(await screen.findByRole("option", { name: /Components/ })).toBeInTheDocument();
    await userEvent.type(input, "{Enter}");
    expect(push).toHaveBeenCalledWith("/components");
  });
});
