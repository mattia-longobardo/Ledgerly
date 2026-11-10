import { render, screen, waitFor } from "@testing-library/react";
import { UnsavedChangesProvider } from "@/ui/unsaved-changes";
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
      <UnsavedChangesProvider>
        <NameForm name="Giulia Rossi" email="giulia@example.test" role="admin" sso={sso} />
      </UnsavedChangesProvider>
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
    await userEvent.click(await screen.findByRole("button", { name: "Save changes" }));
    expect(update).toHaveBeenCalledWith("New Name");
  });

  it("shows a catalogued error instead of crashing when the server refuses (whitespace-only name)", async () => {
    update.mockResolvedValueOnce({ ok: false, error: "invalid" });
    renderForm();
    await userEvent.type(screen.getByLabelText("Full name"), " ");
    await userEvent.click(await screen.findByRole("button", { name: "Save changes" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Enter a name between 1 and 120 characters.");
  });

  it("shows a catalogued error instead of crashing when the action rejects unexpectedly", async () => {
    update.mockRejectedValueOnce(new Error("network down"));
    renderForm();
    await userEvent.type(screen.getByLabelText("Full name"), " ");
    await userEvent.click(await screen.findByRole("button", { name: "Save changes" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(messages.settings.account.errors.failed);
  });

  it("has no Save of its own; the banner appears with a change and leaves once it is saved", async () => {
    update.mockResolvedValueOnce({ ok: true });
    renderForm();
    const input = screen.getByLabelText("Full name");
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    expect(screen.queryByTestId("unsaved-banner")).toBeNull();
    await userEvent.type(input, "x");
    expect(await screen.findByTestId("unsaved-banner")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(update).toHaveBeenCalledWith("Giulia Rossix");
    await waitFor(() => expect(screen.queryByTestId("unsaved-banner")).toBeNull());
  });

  it("shows the avatar initials and the role in the card footer", () => {
    renderForm();
    expect(screen.getByText("GR")).toBeInTheDocument();
    expect(screen.getByText("Admin").parentElement).toHaveTextContent("Role: Admin");
  });

  it("shows the SSO note for an SSO-linked account", () => {
    renderForm(true);
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
    expect(screen.getByText(messages.settings.account.ssoNote)).toBeInTheDocument();
  });
});
