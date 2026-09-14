import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import messages from "../../../../messages/en.json";
import { ForgotForm } from "./forgot-form";

const requestPasswordReset = vi.fn();
vi.mock("@/platform/auth/client", () => ({
  authClient: { requestPasswordReset: (...a: unknown[]) => requestPasswordReset(...a) },
}));

function renderForm() {
  render(
    <NextIntlClientProvider locale="en" messages={messages} timeZone="Europe/Rome">
      <ForgotForm />
    </NextIntlClientProvider>,
  );
}

async function submit() {
  await userEvent.type(screen.getByLabelText("Email"), "a@example.test");
  await userEvent.click(screen.getByRole("button", { name: "Send reset link" }));
}

describe("ForgotForm", () => {
  beforeEach(() => requestPasswordReset.mockReset());

  it("disables the button while the request is in flight", async () => {
    let settle: (value: unknown) => void = () => {};
    requestPasswordReset.mockReturnValueOnce(new Promise((resolve) => (settle = resolve)));
    renderForm();
    await submit();
    expect(screen.getByRole("button", { name: "Send reset link" })).toBeDisabled();
    settle({ data: { status: true }, error: null });
    expect(await screen.findByRole("status")).toHaveTextContent("a reset link is on its way");
    expect(requestPasswordReset).toHaveBeenCalledTimes(1);
  });

  it("gives the same answer when the server refuses", async () => {
    requestPasswordReset.mockResolvedValueOnce({ data: null, error: { status: 429 } });
    renderForm();
    await submit();
    expect(await screen.findByRole("status")).toHaveTextContent("a reset link is on its way");
  });
});
