import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";
import messages from "../../../../messages/en.json";
import { FundSettingsForm, NewFundButton } from "./fund-forms";
import { fundDraft, newFundDraft } from "./present";
import type { Fund } from "../service";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }));

const createFund = vi.fn<(input: Record<string, string>) => Promise<{ ok: true; id: string }>>(async () => ({
  ok: true,
  id: "f1",
}));
vi.mock("../actions", () => ({
  createFundAction: (input: Record<string, string>) => createFund(input),
  updateFundAction: vi.fn(async () => ({ ok: true })),
  deleteDepositAction: vi.fn(),
  deleteValuationAction: vi.fn(),
  recordValuationAction: vi.fn(),
  saveDepositAction: vi.fn(),
  saveDepositRuleAction: vi.fn(),
  setFundStateAction: vi.fn(),
  updateValuationAction: vi.fn(),
}));

const ACCOUNTS = [{ id: "a1", name: "ING Conto Arancio" }];

function renderNewFund(createPension = vi.fn(async () => ({ ok: true as const, id: "p1", count: 3 }))) {
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <NewFundButton
        draft={newFundDraft("2026-09-20")}
        accounts={ACCOUNTS}
        valuationAccounts={ACCOUNTS}
        createPension={createPension}
        label="Add fund"
      />
    </NextIntlClientProvider>,
  );
  return createPension;
}

async function openDialog() {
  await userEvent.click(screen.getByRole("button", { name: "Add fund" }));
  return screen.getByRole("dialog", { name: "New fund" });
}

/** One "Add fund" for both kinds (design "Fund kind"): the choice drives fields and action. */
describe("NewFundButton", () => {
  it("opens on the accumulation plan, with the whole monthly plan", async () => {
    renderNewFund();
    const dialog = await openDialog();
    expect(dialog.querySelector("form")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Accumulation plan (PAC)" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByLabelText("Monthly amount debited (€)")).toBeInTheDocument();
    expect(screen.getByLabelText("ISIN")).toBeInTheDocument();
    expect(screen.getByLabelText("Initial capital (€)")).toBeInTheDocument();
    expect(screen.getByLabelText("Start date")).toBeInTheDocument();
  });

  it("drops the plan's fields when the pension fund is chosen, and brings them back", async () => {
    renderNewFund();
    await openDialog();
    await userEvent.click(screen.getByRole("button", { name: "Pension fund" }));
    expect(screen.queryByLabelText("Monthly amount debited (€)")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("ISIN")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Fee per deposit (€)")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Paying account")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Initial capital (€)")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Member since")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Accumulation plan (PAC)" }));
    expect(screen.getByLabelText("Monthly amount debited (€)")).toBeInTheDocument();
  });

  it("saves a PAC through the funds action", async () => {
    renderNewFund();
    await openDialog();
    await userEvent.type(screen.getByLabelText("Name"), "Fideuram");
    await userEvent.type(screen.getByLabelText("Monthly amount debited (€)"), "251");
    await userEvent.click(screen.getByRole("button", { name: "Save fund" }));
    await waitFor(() => expect(createFund).toHaveBeenCalledOnce());
    expect(createFund.mock.calls[0][0]).toMatchObject({ name: "Fideuram", monthly: "251" });
  });

  it("saves a pension fund through the action that also publishes the payslips", async () => {
    const createPension = renderNewFund();
    await openDialog();
    await userEvent.click(screen.getByRole("button", { name: "Pension fund" }));
    await userEvent.type(screen.getByLabelText("Name"), "Cometa");
    await userEvent.type(screen.getByLabelText("Provider"), "Cometa");
    await userEvent.type(screen.getByLabelText("Type / compartment"), "Crescita");
    await userEvent.click(screen.getByRole("button", { name: "Save fund" }));
    await waitFor(() => expect(createPension).toHaveBeenCalledOnce());
    expect(createPension).toHaveBeenCalledWith({
      name: "Cometa",
      provider: "Cometa",
      compartment: "Crescita",
      startOn: "2026-09-20",
    });
    expect(createFund).not.toHaveBeenCalled();
    await waitFor(() => expect(push).toHaveBeenCalledWith("/funds/p1"));
  });
});

const FUND = {
  id: "f1",
  name: "Fideuram Piano Accumulo",
  provider: "Fideuram",
  isin: "IE00B4L5Y983",
  compartment: "",
  debitAccountId: "a1",
  debitDay: 5,
  ter: "0.012",
  startOn: "2026-01-01",
  monthlyCents: 25_100n,
  depositFeeCents: 100n,
} as unknown as Fund;

describe("FundSettingsForm", () => {
  it("shows the kind but does not let it be switched", async () => {
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <FundSettingsForm fundId="f1" draft={fundDraft(FUND, "it-IT")} accounts={ACCOUNTS} />
      </NextIntlClientProvider>,
    );
    expect(screen.getByRole("button", { name: "Accumulation plan (PAC)" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "Pension fund" })).toBeDisabled();
    expect(screen.getByText(messages.funds.settings.general.kindFixed)).toBeInTheDocument();
  });
});
