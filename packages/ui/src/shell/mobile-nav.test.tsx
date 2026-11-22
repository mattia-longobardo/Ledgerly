import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { NavLink } from "./nav-types";
import { ShellProvider } from "./shell-context";
import { MobileNav } from "./mobile-nav";

const push = vi.hoisted(() => vi.fn());
const signOut = vi.hoisted(() => vi.fn());
vi.mock("../router", async (original) => ({
  ...(await original<object>()),
  ...{ usePathname: () => "/settings/profile", useRouter: () => ({ push }) },
}));

const LINKS: NavLink[] = [
  { id: "overview", href: "/", label: "Overview", icon: "overview", group: "everyday", mobile: true },
  {
    id: "components",
    href: "/components",
    label: "Components",
    icon: "funds",
    group: "system",
    mobile: false,
  },
  {
    id: "settings",
    href: "/settings/profile",
    label: "Settings",
    icon: "settings",
    group: "footer",
    mobile: false,
  },
];

const LABELS = {
  product: "Ledgerly",
  primary: "Primary",
  groups: { everyday: "Everyday", savings: "Savings and investments", work: "Work", system: "System" },
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

async function openMore() {
  render(
    <ShellProvider
      initialSidebar="expanded"
      labels={LABELS}
      saveTheme={async () => undefined}
      signOut={signOut}
    >
      <MobileNav links={LINKS} user={{ name: "Anna Bianchi", via: "via Authentik" }} />
    </ShellProvider>,
  );
  const more = screen.getByRole("button", { name: LABELS.more });
  expect(more).toHaveAttribute("aria-haspopup", "dialog");
  expect(more).toHaveAttribute("aria-expanded", "false");
  await userEvent.click(more);
  return screen.getByRole("dialog", { name: LABELS.more });
}

describe("MobileNav", () => {
  it("marks the current page inside the More sheet, and leaves other items unmarked", async () => {
    const sheet = await openMore();
    expect(within(sheet).getByRole("link", { name: /Settings/ })).toHaveAttribute("aria-current", "page");
    expect(within(sheet).getByRole("link", { name: /Components/ })).not.toHaveAttribute("aria-current");
  });

  it("lists Settings and Components under System, in the design's order", async () => {
    const sheet = await openMore();
    const system = within(sheet).getByRole("group", { name: "System" });
    expect(
      within(system)
        .getAllByRole("link")
        .map((link) => link.textContent),
    ).toEqual(["Settings", "Components"]);
  });

  it("shows who is signed in and signs out from the sheet", async () => {
    signOut.mockResolvedValueOnce(undefined);
    const sheet = await openMore();
    expect(within(sheet).getByText("Anna Bianchi")).toBeInTheDocument();
    expect(within(sheet).getByText("via Authentik")).toBeInTheDocument();
    await userEvent.click(within(sheet).getByRole("button", { name: "Sign out" }));
    expect(signOut).toHaveBeenCalledOnce();
    expect(push).toHaveBeenCalledWith("/sign-in");
  });
});
