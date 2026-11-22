import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";
import messages from "../../../../../../../messages/en.json";
import { HideAmountsSwitch } from "./hide-amounts";

const save = vi.fn();
vi.mock("./calls", () => ({ saveHideAmounts: (...a: unknown[]) => save(...a) }));
vi.mock("@ledgerly/ui/toast", () => ({ notify: vi.fn() }));

function renderSwitch() {
  render(
    <NextIntlClientProvider locale="en" messages={messages} timeZone="Europe/Rome">
      <HideAmountsSwitch initial={false} />
    </NextIntlClientProvider>,
  );
  return screen.getByRole("switch", { name: "Hide amounts" });
}

describe("HideAmountsSwitch", () => {
  it("reads «on» only once the server saved the choice", async () => {
    let answer = () => {};
    save.mockReturnValueOnce(new Promise<void>((resolve) => (answer = resolve)));
    const control = renderSwitch();
    await userEvent.click(control);
    expect(save).toHaveBeenCalledWith(true);
    expect(control).toHaveAttribute("aria-checked", "false");
    answer();
    await waitFor(() => expect(control).toHaveAttribute("aria-checked", "true"));
  });

  it("stays off when the save fails", async () => {
    save.mockRejectedValueOnce(new Error("network down"));
    const control = renderSwitch();
    await userEvent.click(control);
    await waitFor(() => expect(control).not.toBeDisabled());
    expect(control).toHaveAttribute("aria-checked", "false");
  });
});
