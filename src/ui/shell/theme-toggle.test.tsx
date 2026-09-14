import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Toaster } from "@/ui/toast";
import { ShellProvider } from "./shell-context";
import { ThemeToggle } from "./theme-toggle";

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

function renderToggle(onSave: (theme: "system" | "light" | "dark") => Promise<void>) {
  return render(
    <ShellProvider initialCollapsed={false} labels={LABELS}>
      <ThemeToggle onSave={onSave} />
      <Toaster closeLabel="Close" />
    </ShellProvider>,
  );
}

describe("ThemeToggle", () => {
  afterEach(() => {
    delete document.documentElement.dataset.theme;
    document.cookie = "theme=; path=/; max-age=0";
  });

  it("flips the theme immediately and persists it on a successful save", async () => {
    document.documentElement.dataset.theme = "light";
    const onSave = vi.fn().mockResolvedValue(undefined);
    renderToggle(onSave);

    await userEvent.click(screen.getByRole("button", { name: LABELS.toggleTheme }));

    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(document.cookie).toContain("theme=dark");
    expect(onSave).toHaveBeenCalledWith("dark");
  });

  it("reverts the attribute and cookie and shows a toast when the save is rejected, without throwing", async () => {
    document.documentElement.dataset.theme = "light";
    const onSave = vi.fn().mockRejectedValue(new Error("network error"));
    renderToggle(onSave);

    await userEvent.click(screen.getByRole("button", { name: LABELS.toggleTheme }));

    expect(await screen.findByRole("alert")).toHaveTextContent(LABELS.themeSaveError);
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(document.cookie).toContain("theme=light");
  });

  it('restores a "system" preference (not a concrete light/dark) when the save is rejected', async () => {
    // The rendered attribute is always resolved to light/dark (THEME_SCRIPT resolves "system" via
    // matchMedia before first paint); only the cookie can say the actual preference was "system".
    document.cookie = "theme=system; path=/";
    document.documentElement.dataset.theme = "light";
    const onSave = vi.fn().mockRejectedValue(new Error("network error"));
    renderToggle(onSave);

    await userEvent.click(screen.getByRole("button", { name: LABELS.toggleTheme }));

    expect(await screen.findByRole("alert")).toHaveTextContent(LABELS.themeSaveError);
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(document.cookie).toContain("theme=system");
  });
});
