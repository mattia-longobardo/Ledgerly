import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import messages from "../../../../../messages/en.json";
import { DEFAULT_PREFERENCES } from "@/modules/users/rules";
import { ThemeProvider } from "@/ui/theme-provider";
import { stubColorScheme } from "../../../../../test/color-scheme";
import { PreferencesForm } from "./preferences-form";

const save = vi.fn();
vi.mock("@/modules/users/actions", () => ({ savePreferencesAction: (...a: unknown[]) => save(...a) }));

function renderForm(initial = DEFAULT_PREFERENCES) {
  render(
    <NextIntlClientProvider locale="en" messages={messages} timeZone="Europe/Rome">
      <ThemeProvider saved={initial.theme}>
        <PreferencesForm initial={initial} timeZones={["Europe/Rome", "Europe/London"]} />
      </ThemeProvider>
    </NextIntlClientProvider>,
  );
}

describe("PreferencesForm", () => {
  beforeEach(() => stubColorScheme(false));
  afterEach(() => {
    vi.unstubAllGlobals();
    delete document.documentElement.dataset.theme;
  });

  it("submits the edited preferences and applies the saved theme", async () => {
    save.mockResolvedValueOnce({ ok: true });
    renderForm();
    await userEvent.selectOptions(screen.getByLabelText("Language"), "it");
    await userEvent.selectOptions(screen.getByLabelText("Theme"), "dark");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(save).toHaveBeenCalledWith({ ...DEFAULT_PREFERENCES, locale: "it", theme: "dark" });
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("shows a catalogued error instead of crashing when the action refuses to save", async () => {
    save.mockResolvedValueOnce({ ok: false, error: "invalid" });
    renderForm();
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(messages.settings.preferences.errors.invalid);
  });

  it("shows a catalogued error instead of crashing when the action rejects unexpectedly", async () => {
    save.mockRejectedValueOnce(new Error("network down"));
    renderForm();
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(messages.settings.preferences.errors.failed);
  });

  it("clamps the patron-saint day to the selected month's length, and gives the day its own label", async () => {
    save.mockResolvedValueOnce({ ok: true });
    renderForm({ ...DEFAULT_PREFERENCES, patronSaint: { month: 1, day: 31 } });
    // Only the month select carries the "Patron saint holiday" accessible name; the day select has
    // its own distinct label ("Day"), so a screen reader never announces the same name twice.
    await userEvent.selectOptions(screen.getByLabelText("Patron saint holiday"), "2");
    expect(screen.getByLabelText("Day")).toHaveDisplayValue("28");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ patronSaint: { month: 2, day: 28 } }));
  });
});
