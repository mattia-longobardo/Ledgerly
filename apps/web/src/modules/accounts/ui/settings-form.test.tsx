import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";
import { DeleteAccount } from "@/app/(app)/accounts/[id]/delete-account";
import { UnsavedChangesProvider } from "@ledgerly/ui/unsaved-changes";
import messages from "../../../../../../messages/en.json";
import { AccountSettingsForm, type SettingsValues } from "./settings-form";

const list = vi.fn();
vi.mock("@/app/(app)/accounts/[id]/delete-actions", () => ({
  accountDependentsAction: (...args: unknown[]) => list(...args),
  moveDependentAction: vi.fn(),
  deleteAccountAction: vi.fn(),
}));
vi.mock("../actions", () => ({
  archiveAccountAction: vi.fn(),
  restoreAccountAction: vi.fn(),
  saveAccountSettingsAction: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

const T = messages.accounts.settings.danger;
const ID = "00000000-0000-4000-8000-000000000001";

const account = (state: SettingsValues["state"]): SettingsValues => ({
  id: ID,
  name: "Holidays",
  type: "checking",
  currency: "EUR",
  provider: null,
  origin: "manual",
  state,
  color: null,
  reference: null,
  iban: null,
  ibanFromSource: false,
  ibanField: true,
  purpose: null,
  openedOn: null,
  notes: null,
  inNetWorth: true,
  inSnapshot: true,
  countsAsLiquid: true,
  lowBalance: "",
  staleAfterHours: 24,
  reminder: "none",
  betweenEntries: "flat",
});

function renderForm(state: SettingsValues["state"]) {
  render(
    <NextIntlClientProvider locale="en" messages={messages} timeZone="Europe/Rome">
      <UnsavedChangesProvider>
        <AccountSettingsForm
          account={account(state)}
          index={0}
          today="2026-11-18"
          deleteControl={<DeleteAccount accountId={ID} name="Holidays" source={null} />}
        />
      </UnsavedChangesProvider>
    </NextIntlClientProvider>,
  );
}

describe("AccountSettingsForm › Danger zone (PERS-421)", () => {
  it("offers Restore and Delete on an archived account, and Delete opens the same dialog", async () => {
    list.mockResolvedValueOnce({ ok: true, dependents: [], targets: [] });
    renderForm("archived");
    expect(screen.getByRole("button", { name: T.restore })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: T.archive })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: T.remove }));
    expect(list).toHaveBeenCalledWith(ID);
    expect(await screen.findByText(T.confirmBody.replace("{name}", "Holidays"))).toBeInTheDocument();
  });

  it("offers Archive and Delete on an open account", () => {
    renderForm("active");
    expect(screen.getByRole("button", { name: T.archive })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: T.remove })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: T.restore })).toBeNull();
  });
});
