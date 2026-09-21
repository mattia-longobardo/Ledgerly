import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";
import messages from "../../../../../messages/en.json";
import { NewToken } from "./new-token";

const createToken = vi.fn();
vi.mock("./actions", () => ({ createTokenAction: (...a: unknown[]) => createToken(...a) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

function renderButton() {
  render(
    <NextIntlClientProvider locale="en" messages={messages} timeZone="Europe/Rome">
      <NewToken />
    </NextIntlClientProvider>,
  );
}

async function openAndCreate(name = "Home Assistant") {
  await userEvent.click(screen.getByRole("button", { name: "New token" }));
  await userEvent.type(screen.getByLabelText("Name"), name);
  await userEvent.click(screen.getByRole("button", { name: "Create token" }));
}

describe("NewToken", () => {
  it("sends the name, the ticked scopes and the expiry", async () => {
    createToken.mockResolvedValueOnce({ ok: true, token: "pat_abcdefgh.secret", prefix: "abcdefgh" });
    renderButton();
    await userEvent.click(screen.getByRole("button", { name: "New token" }));
    await userEvent.type(screen.getByLabelText("Name"), "Scripts");
    await userEvent.click(screen.getByLabelText(/^imports/));
    await userEvent.selectOptions(screen.getByLabelText("Expires"), "never");
    await userEvent.click(screen.getByRole("button", { name: "Create token" }));
    expect(createToken).toHaveBeenCalledWith({
      name: "Scripts",
      scopes: ["read", "imports"],
      expiresInDays: null,
    });
  });

  it("shows the value once, with the warning that it will not come back", async () => {
    createToken.mockResolvedValueOnce({ ok: true, token: "pat_abcdefgh.the-secret", prefix: "abcdefgh" });
    renderButton();
    await openAndCreate();
    expect(await screen.findByText("pat_abcdefgh.the-secret")).toBeInTheDocument();
    expect(
      screen.getByText("Copy it now: this is the only time it is shown, and it cannot be recovered."),
    ).toBeInTheDocument();
  });

  it("forgets the value once the dialog is closed", async () => {
    createToken.mockResolvedValueOnce({ ok: true, token: "pat_abcdefgh.the-secret", prefix: "abcdefgh" });
    renderButton();
    await openAndCreate();
    await userEvent.click(await screen.findByRole("button", { name: "Done" }));
    await userEvent.click(screen.getByRole("button", { name: "New token" }));
    expect(screen.queryByText("pat_abcdefgh.the-secret")).not.toBeInTheDocument();
  });

  it("keeps the form open and says why when the service refuses", async () => {
    createToken.mockResolvedValueOnce({ ok: false, error: "invalid" });
    renderButton();
    await openAndCreate(" ");
    expect(await screen.findByText("Give it a name and at least one scope.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create token" })).toBeInTheDocument();
  });
});
