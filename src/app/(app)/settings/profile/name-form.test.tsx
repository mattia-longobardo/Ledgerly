import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";
import messages from "../../../../../messages/en.json";
import { NameForm } from "./name-form";

const update = vi.fn();
vi.mock("@/modules/users/actions", () => ({ updateNameAction: (...a: unknown[]) => update(...a) }));

function renderForm(sso = false) {
  render(
    <NextIntlClientProvider locale="en" messages={messages} timeZone="Europe/Rome">
      <NameForm name="Giulia Rossi" email="giulia@example.test" sso={sso} />
    </NextIntlClientProvider>,
  );
}

describe("NameForm", () => {
  it("submits the entered name", async () => {
    update.mockResolvedValueOnce({ ok: true });
    renderForm();
    const input = screen.getByLabelText("Full name");
    await userEvent.clear(input);
    await userEvent.type(input, "New Name");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(update).toHaveBeenCalledWith("New Name");
  });

  it("shows a catalogued error instead of crashing when the server refuses (whitespace-only name)", async () => {
    update.mockResolvedValueOnce({ ok: false, error: "invalid" });
    renderForm();
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(messages.settings.account.errors.invalid);
  });

  it("shows a catalogued error instead of crashing when the action rejects unexpectedly", async () => {
    update.mockRejectedValueOnce(new Error("network down"));
    renderForm();
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(messages.settings.account.errors.failed);
  });

  it("hides the Save button and shows the SSO note for an SSO-linked account", () => {
    renderForm(true);
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
    expect(screen.getByText(messages.settings.account.ssoNote)).toBeInTheDocument();
  });
});
