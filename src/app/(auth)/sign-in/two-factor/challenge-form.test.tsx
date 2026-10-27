import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import messages from "../../../../../messages/en.json";
import { ChallengeForm } from "./challenge-form";

const verifyTotp = vi.fn();
const verifyBackupCode = vi.fn();
vi.mock("@/platform/auth/client", () => ({
  authClient: {
    twoFactor: {
      verifyTotp: (...a: unknown[]) => verifyTotp(...a),
      verifyBackupCode: (...a: unknown[]) => verifyBackupCode(...a),
    },
  },
}));
const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }));

function renderForm() {
  render(
    <NextIntlClientProvider locale="en" messages={messages} timeZone="Europe/Rome">
      <ChallengeForm trustDays={30} />
    </NextIntlClientProvider>,
  );
}

describe("ChallengeForm", () => {
  beforeEach(() => {
    verifyTotp.mockReset();
    verifyBackupCode.mockReset();
    push.mockReset();
  });

  it("verifies the app's code, trusts the device when asked, and opens the app", async () => {
    verifyTotp.mockResolvedValueOnce({ data: { token: "t" }, error: null });
    renderForm();
    await userEvent.type(screen.getByLabelText("Authentication code"), "123 456");
    await userEvent.click(screen.getByLabelText("Trust this device for 30 days"));
    await userEvent.click(screen.getByRole("button", { name: "Verify" }));
    expect(verifyTotp).toHaveBeenCalledWith({ code: "123456", trustDevice: true });
    expect(push).toHaveBeenCalledWith("/");
  });

  it("takes a recovery code instead", async () => {
    verifyBackupCode.mockResolvedValueOnce({ data: { token: "t" }, error: null });
    renderForm();
    await userEvent.click(screen.getByRole("button", { name: "Use a recovery code" }));
    await userEvent.type(screen.getByLabelText("Recovery code"), " abcde-12345 ");
    await userEvent.click(screen.getByRole("button", { name: "Verify" }));
    expect(verifyBackupCode).toHaveBeenCalledWith({ code: "abcde-12345", trustDevice: false });
  });

  it("says a code is wrong and stays on the page", async () => {
    verifyTotp.mockResolvedValueOnce({ data: null, error: { code: "INVALID_CODE", status: 401 } });
    renderForm();
    await userEvent.type(screen.getByLabelText("Authentication code"), "000000");
    await userEvent.click(screen.getByRole("button", { name: "Verify" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("That code is not right.");
    expect(push).not.toHaveBeenCalled();
  });

  it("stops at the lockout and after too many attempts", async () => {
    verifyTotp.mockResolvedValueOnce({
      data: null,
      error: { code: "TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE", status: 400 },
    });
    renderForm();
    await userEvent.type(screen.getByLabelText("Authentication code"), "000000");
    await userEvent.click(screen.getByRole("button", { name: "Verify" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Too many wrong codes. Sign in again.");
    expect(screen.getByRole("button", { name: "Verify" })).toBeDisabled();
  });
});
