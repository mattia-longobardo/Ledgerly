import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import messages from "../../../../../messages/en.json";
import { InviteForm } from "./invite-form";

const signInSocial = vi.fn();
const acceptInviteAction = vi.fn();
vi.mock("@/platform/auth/client", () => ({
  authClient: { signIn: { social: (...a: unknown[]) => signInSocial(...a) } },
}));
vi.mock("../../actions", () => ({ acceptInviteAction: (...a: unknown[]) => acceptInviteAction(...a) }));

function renderForm(initialError: "email_mismatch" | null = null, token = "tok") {
  render(
    <NextIntlClientProvider locale="en" messages={messages} timeZone="Europe/Rome">
      <InviteForm token={token} initialError={initialError} />
    </NextIntlClientProvider>,
  );
}

async function fill(password: string, confirm = password) {
  await userEvent.type(screen.getByLabelText("Full name"), "Giulia Rossi");
  await userEvent.type(screen.getByLabelText("Password"), password);
  await userEvent.type(screen.getByLabelText("Confirm new password"), confirm);
  await userEvent.click(screen.getByRole("button", { name: "Create account" }));
}

describe("InviteForm", () => {
  beforeEach(() => {
    signInSocial.mockReset();
    acceptInviteAction.mockReset();
  });

  it("returns from Authentik to the completion route of this invitation", async () => {
    signInSocial.mockResolvedValueOnce({ data: { url: "https://auth.example.test/authorize" }, error: null });
    renderForm(null, "a?b");
    await userEvent.click(screen.getByRole("button", { name: "Use Authentik instead" }));
    expect(signInSocial).toHaveBeenCalledWith(
      expect.objectContaining({ provider: "authentik", callbackURL: "/invite/a%3Fb/complete" }),
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("says so when the Authentik sign-in cannot start", async () => {
    signInSocial.mockResolvedValueOnce({ data: null, error: { status: 404 } });
    renderForm();
    await userEvent.click(screen.getByRole("button", { name: "Use Authentik instead" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Sign-in with Authentik failed. Try again.");
  });

  it("explains an Authentik account with another address", () => {
    renderForm("email_mismatch");
    expect(screen.getByRole("alert")).toHaveTextContent(
      "different email address than your Authentik account",
    );
  });

  it("states both password bounds and checks them before submitting", async () => {
    renderForm();
    expect(screen.getByText("Between 12 and 128 characters.")).toBeInTheDocument();
    await fill("a".repeat(129));
    expect(screen.getByRole("alert")).toHaveTextContent("Between 12 and 128 characters.");
    expect(acceptInviteAction).not.toHaveBeenCalled();
  });

  it("checks the confirmation before submitting", async () => {
    renderForm();
    await fill("long-enough-password", "another-long-password");
    expect(screen.getByRole("alert")).toHaveTextContent("The two passwords do not match.");
    expect(acceptInviteAction).not.toHaveBeenCalled();
  });

  it("shows the reason the server refused the invitation", async () => {
    acceptInviteAction.mockResolvedValueOnce({ error: "email_taken" });
    renderForm();
    await fill("long-enough-password");
    expect(acceptInviteAction).toHaveBeenCalledWith("tok", {
      name: "Giulia Rossi",
      password: "long-enough-password",
      confirm: "long-enough-password",
    });
    expect(await screen.findByRole("alert")).toHaveTextContent("An account with this email already exists.");
  });
});
