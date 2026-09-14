import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";
import messages from "../../../../../messages/en.json";
import { DEFAULT_PREFERENCES } from "@/modules/users/rules";
import { PreferencesForm } from "./preferences-form";

const save = vi.fn();
vi.mock("@/modules/users/actions", () => ({ savePreferencesAction: (...a: unknown[]) => save(...a) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

describe("PreferencesForm", () => {
  it("submits the edited preferences", async () => {
    save.mockResolvedValueOnce(undefined);
    render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="Europe/Rome">
        <PreferencesForm initial={DEFAULT_PREFERENCES} timeZones={["Europe/Rome", "Europe/London"]} />
      </NextIntlClientProvider>,
    );
    await userEvent.selectOptions(screen.getByLabelText("Language"), "it");
    await userEvent.selectOptions(screen.getByLabelText("Theme"), "dark");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(save).toHaveBeenCalledWith({ ...DEFAULT_PREFERENCES, locale: "it", theme: "dark" });
  });
});
