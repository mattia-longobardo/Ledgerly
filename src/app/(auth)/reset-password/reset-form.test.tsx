import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import messages from "../../../../messages/en.json";
import { ResetForm } from "./reset-form";

const resetPassword = vi.fn();
const push = vi.fn();
vi.mock("@/platform/auth/client", () => ({
  authClient: { resetPassword: (...a: unknown[]) => resetPassword(...a) },
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

function renderForm() {
  render(
    <NextIntlClientProvider locale="en" messages={messages} timeZone="Europe/Rome">
      <ResetForm token="reset-token" />
    </NextIntlClientProvider>,
  );
}

async function submit(password: string) {
  await userEvent.type(screen.getByLabelText("New password"), password);
  await userEvent.type(screen.getByLabelText("Confirm new password"), password);
  await userEvent.click(screen.getByRole("button", { name: "Set password" }));
}

describe("ResetForm", () => {
  beforeEach(() => {
    resetPassword.mockReset();
    push.mockReset();
  });

  it.each([["short"], ["a".repeat(129)]])("refuses a password of the wrong length (%#)", async (password) => {
    renderForm();
    await submit(password);
    expect(screen.getByRole("alert")).toHaveTextContent("Between 12 and 128 characters.");
    expect(resetPassword).not.toHaveBeenCalled();
  });

  it("disables the button while the request is in flight, then goes to sign-in", async () => {
    let settle: (value: unknown) => void = () => {};
    resetPassword.mockReturnValueOnce(new Promise((resolve) => (settle = resolve)));
    renderForm();
    await submit("long-enough-password");
    expect(screen.getByRole("button", { name: "Set password" })).toBeDisabled();
    settle({ data: { status: true }, error: null });
    await vi.waitFor(() => expect(push).toHaveBeenCalledWith("/sign-in"));
    expect(resetPassword).toHaveBeenCalledWith({ newPassword: "long-enough-password", token: "reset-token" });
  });

  it("reports an expired or used link", async () => {
    resetPassword.mockResolvedValueOnce({ data: null, error: { code: "INVALID_TOKEN" } });
    renderForm();
    await submit("long-enough-password");
    expect(await screen.findByRole("alert")).toHaveTextContent("invalid or has expired");
    expect(screen.getByRole("button", { name: "Set password" })).toBeEnabled();
  });
});
