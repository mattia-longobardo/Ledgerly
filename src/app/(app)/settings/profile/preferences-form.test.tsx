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
        <PreferencesForm
          initial={initial}
          timeZones={[
            { value: "Europe/Rome", label: "Europe/Rome (UTC+2)" },
            { value: "Europe/London", label: "Europe/London (UTC+1)" },
          ]}
        />
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

  it("saves the decimal separator and the euro's position, and starts from the saved ones", async () => {
    save.mockResolvedValueOnce({ ok: true });
    renderForm();
    // Left alone, both follow the number format: the first option of each select.
    expect(screen.getByLabelText("Decimal separator")).toHaveValue("");
    expect(screen.getByLabelText("Currency sign")).toHaveValue("");
    await userEvent.selectOptions(screen.getByLabelText("Decimal separator"), ".");
    await userEvent.selectOptions(screen.getByLabelText("Currency sign"), "after");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(save).toHaveBeenCalledWith({
      ...DEFAULT_PREFERENCES,
      decimalSeparator: ".",
      currencyPosition: "after",
    });
  });

  it("shows the saved overrides when they are set", () => {
    renderForm({ ...DEFAULT_PREFERENCES, decimalSeparator: ",", currencyPosition: "before" });
    expect(screen.getByLabelText("Decimal separator")).toHaveValue(",");
    expect(screen.getByLabelText("Currency sign")).toHaveValue("before");
  });

  it("offers EUR and the ECB currencies as the display currency, and saves the one picked", async () => {
    save.mockResolvedValueOnce({ ok: true });
    renderForm();
    const field = screen.getByLabelText("Display currency");
    expect(field).toHaveValue("EUR");
    expect(screen.getByRole("option", { name: "USD · US Dollar" })).toHaveValue("USD");
    expect(screen.queryByRole("option", { name: /^BGN/ })).toBeNull();
    await userEvent.selectOptions(field, "USD");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(save).toHaveBeenCalledWith({ ...DEFAULT_PREFERENCES, displayCurrency: "USD" });
  });

  it("labels every timezone with its UTC offset", () => {
    renderForm();
    expect(screen.getByRole("option", { name: "Europe/Rome (UTC+2)" })).toHaveValue("Europe/Rome");
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
});
