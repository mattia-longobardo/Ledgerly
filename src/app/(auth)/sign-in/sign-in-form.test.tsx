import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
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
const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }));

function renderForm(error: SignInErrorKey | null = null) {
  render(
    <NextIntlClientProvider locale="en" messages={messages} timeZone="Europe/Rome">
      <SignInForm initialError={error} />
    </NextIntlClientProvider>,
  );
}

const authentik = () => userEvent.click(screen.getByRole("button", { name: "Continue with Authentik" }));

describe("SignInForm", () => {
  beforeEach(() => {
    signInEmail.mockReset();
    signInSocial.mockReset();
    push.mockReset();
  });

  async function submitPassword() {
    await userEvent.type(screen.getByLabelText("Email"), "a@example.test");
    await userEvent.type(screen.getByLabelText("Password"), "a-password-123");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
  }

  it("sends an account with TOTP to the code page, not into the app", async () => {
    signInEmail.mockResolvedValueOnce({
      data: { twoFactorRedirect: true, twoFactorMethods: ["totp"] },
      error: null,
    });
    renderForm();
    await submitPassword();
    expect(push).toHaveBeenCalledWith("/sign-in/two-factor");
    expect(push).not.toHaveBeenCalledWith("/");
  });

  it("opens the app after a password sign-in without a second step", async () => {
    signInEmail.mockResolvedValueOnce({ data: { token: "t", user: {} }, error: null });
    renderForm();
    await submitPassword();
    expect(push).toHaveBeenCalledWith("/");
  });

  it("offers Authentik and password sign-in", async () => {
    signInSocial.mockResolvedValueOnce({ data: { url: "https://auth.example.test/authorize" }, error: null });
    renderForm();
    await authentik();
    expect(signInSocial).toHaveBeenCalledWith(expect.objectContaining({ provider: "authentik" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("says so when the Authentik sign-in cannot start", async () => {
    signInSocial.mockResolvedValueOnce({ data: null, error: { status: 404 } });
    renderForm();
    await authentik();
    expect(await screen.findByRole("alert")).toHaveTextContent("Sign-in with Authentik failed. Try again.");
  });

  it("says so when the Authentik request fails outright", async () => {
    signInSocial.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    renderForm();
    await authentik();
    expect(await screen.findByRole("alert")).toHaveTextContent("Sign-in with Authentik failed. Try again.");
  });

  it("shows the error returned by a failed password sign-in", async () => {
    signInEmail.mockResolvedValueOnce({ error: { code: "INVALID_EMAIL_OR_PASSWORD" } });
    renderForm();
    await userEvent.type(screen.getByLabelText("Email"), "a@example.test");
    await userEvent.type(screen.getByLabelText("Password"), "wrong-password");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Wrong email or password.");
  });

  it("tells a blocked user so once the password is right", async () => {
    signInEmail.mockResolvedValueOnce({ error: { code: "BANNED_USER" } });
    renderForm();
    await userEvent.type(screen.getByLabelText("Email"), "a@example.test");
    await userEvent.type(screen.getByLabelText("Password"), "right-password");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Your account is blocked.");
  });

  it("recovers from a password sign-in request that fails outright", async () => {
    signInEmail.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    renderForm();
    await userEvent.type(screen.getByLabelText("Email"), "a@example.test");
    await userEvent.type(screen.getByLabelText("Password"), "any-password");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Sign-in failed. Try again.");
    expect(screen.getByRole("button", { name: "Sign in" })).toBeEnabled();
  });

  it("explains why Authentik refused an address that already signs in another way", () => {
    renderForm("accountNotLinked");
    expect(screen.getByRole("alert")).toHaveTextContent(
      "This email is already linked to a different sign-in method. Sign in the way you did before.",
    );
  });

  it("shows an error carried in the URL", () => {
    renderForm("invitationRequired");
    expect(screen.getByRole("alert")).toHaveTextContent("needs an invitation");
  });
});
