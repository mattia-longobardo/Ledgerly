import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { stubColorScheme } from "../../test/color-scheme";
import type { ThemePreference } from "@/platform/theme";
import { ThemeProvider, useTheme } from "./theme-provider";

/** Stands in for the toggle and the preferences form: a local, not yet saved, choice. */
function Chooser() {
  const { setPreference } = useTheme();
  return (
    <>
      <button type="button" onClick={() => setPreference("light")}>
        Light
      </button>
      <button type="button" onClick={() => setPreference("dark")}>
        Dark
      </button>
    </>
  );
}

function renderProvider(saved: ThemePreference) {
  return render(
    <ThemeProvider saved={saved}>
      <Chooser />
    </ThemeProvider>,
  );
}

const theme = () => document.documentElement.dataset.theme;

describe("ThemeProvider", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete document.documentElement.dataset.theme;
  });

  it("applies the saved preference", () => {
    stubColorScheme(true);
    renderProvider("light");
    expect(theme()).toBe("light");
  });

  it("follows the OS colour scheme while the preference is System, and stops after a choice", async () => {
    const scheme = stubColorScheme(false);
    renderProvider("system");
    expect(theme()).toBe("light");
    act(() => scheme.setDark(true));
    expect(theme()).toBe("dark");
    await userEvent.click(screen.getByRole("button", { name: "Light" }));
    act(() => scheme.setDark(false));
    act(() => scheme.setDark(true));
    expect(theme()).toBe("light");
  });

  it("takes a newly saved preference over a local choice", async () => {
    stubColorScheme(false);
    const { rerender } = renderProvider("light");
    await userEvent.click(screen.getByRole("button", { name: "Dark" }));
    expect(theme()).toBe("dark");
    rerender(
      <ThemeProvider saved="system">
        <Chooser />
      </ThemeProvider>,
    );
    expect(theme()).toBe("light");
  });
});
