import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";
import messages from "../../../../messages/en.json";
import type { SignInErrorKey } from "./errors";
import { SignInForm } from "./sign-in-form";

const signInEmail = vi.fn();
const signInSocial = vi.fn();
vi.mock("@/platform/auth/client", () => ({
  authClient: {
    signIn: {
      email: (...a: unknown[]) => signInEmail(...a),
      social: (...a: unknown[]) => signInSocial(...a),
    },
  },
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

function renderForm(error: SignInErrorKey | null = null) {
  render(
    <NextIntlClientProvider locale="en" messages={messages} timeZone="Europe/Rome">
      <SignInForm initialError={error} />
    </NextIntlClientProvider>,
  );
}

describe("SignInForm", () => {
  it("offers Authentik and password sign-in", async () => {
    renderForm();
    await userEvent.click(screen.getByRole("button", { name: "Continue with Authentik" }));
    expect(signInSocial).toHaveBeenCalledWith(expect.objectContaining({ provider: "authentik" }));
  });

  it("shows the error returned by a failed password sign-in", async () => {
    signInEmail.mockResolvedValueOnce({ error: { code: "INVALID_EMAIL_OR_PASSWORD" } });
    renderForm();
    await userEvent.type(screen.getByLabelText("Email"), "a@example.test");
    await userEvent.type(screen.getByLabelText("Password"), "wrong-password");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Wrong email or password.");
  });

  it("shows an error carried in the URL", () => {
    renderForm("invitationRequired");
    expect(screen.getByRole("alert")).toHaveTextContent("needs an invitation");
  });
});
