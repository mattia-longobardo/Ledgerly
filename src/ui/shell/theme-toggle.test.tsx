import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { stubColorScheme } from "../../../test/color-scheme";
import type { ThemePreference } from "@/platform/theme";
import { ThemeProvider } from "@/ui/theme-provider";
import { Toaster } from "@/ui/toast";
import { ShellProvider } from "./shell-context";
import { ThemeToggle } from "./theme-toggle";

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
    payees: "Payees",
    empty: "No matches",
    shortcut: "⌘K",
    escape: "esc",
  },
};

function renderToggle(saved: ThemePreference, saveTheme: (theme: ThemePreference) => Promise<void>) {
  return render(
    <ThemeProvider saved={saved}>
      <ShellProvider initialSidebar="expanded" labels={LABELS} saveTheme={saveTheme}>
        <ThemeToggle />
        <Toaster closeLabel="Close" />
      </ShellProvider>
    </ThemeProvider>,
  );
}

const theme = () => document.documentElement.dataset.theme;

describe("ThemeToggle", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete document.documentElement.dataset.theme;
  });

  it("flips the theme at once and saves the new preference", async () => {
    stubColorScheme(false);
    const saveTheme = vi.fn().mockResolvedValue(undefined);
    renderToggle("light", saveTheme);

    await userEvent.click(screen.getByRole("button", { name: LABELS.toggleTheme }));

    expect(theme()).toBe("dark");
    expect(saveTheme).toHaveBeenCalledWith("dark");
  });

  it("puts the theme back and shows an error toast when the save is rejected, without throwing", async () => {
    stubColorScheme(false);
    renderToggle("light", vi.fn().mockRejectedValue(new Error("network error")));

    await userEvent.click(screen.getByRole("button", { name: LABELS.toggleTheme }));

    expect(await screen.findByRole("alert")).toHaveTextContent(LABELS.themeSaveError);
    expect(theme()).toBe("light");
  });

  it('restores a "system" preference, not a concrete light or dark, when the save is rejected', async () => {
    const scheme = stubColorScheme(false);
    renderToggle("system", vi.fn().mockRejectedValue(new Error("network error")));

    await userEvent.click(screen.getByRole("button", { name: LABELS.toggleTheme }));

    expect(await screen.findByRole("alert")).toHaveTextContent(LABELS.themeSaveError);
    expect(theme()).toBe("light");
    // Back on System, the theme follows the OS again.
    act(() => scheme.setDark(true));
    expect(theme()).toBe("dark");
  });
});
