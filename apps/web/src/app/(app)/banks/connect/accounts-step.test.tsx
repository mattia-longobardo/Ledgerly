import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import messages from "../../../../../../../messages/en.json";
import { AccountsStep, type AccountsStepProps } from "./accounts-step";

const importAccounts = vi.fn();
const cancelConnection = vi.fn();
const push = vi.fn();

vi.mock("./actions", () => ({
  importBankAccountsAction: (...args: unknown[]) => importAccounts(...args),
  cancelBankConnectionAction: (...args: unknown[]) => cancelConnection(...args),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }));

const PROPS: AccountsStepProps = {
  connectionId: "c-1",
  bank: "Zeta Bank",
  accounts: [
    {
      providerAccountId: "a-1",
      legend: "Conto · IT60 •••• 3456 · EUR",
      currency: "EUR",
      defaultName: "Zeta Bank Checking",
      defaultType: "checking",
    },
    {
      providerAccountId: "a-2",
      legend: "Deposito · EUR",
      currency: "EUR",
      defaultName: "Zeta Bank Savings",
      defaultType: "savings",
    },
  ],
  linked: [],
  existing: [
    { id: "x-1", name: "Risparmi", currency: "EUR" },
    { id: "x-2", name: "Dollars", currency: "USD" },
  ],
  types: [
    { value: "checking", label: "Checking" },
    { value: "savings", label: "Savings" },
  ],
  cancellable: true,
};

function renderStep(props: Partial<AccountsStepProps> = {}) {
  render(
    <NextIntlClientProvider locale="en" messages={messages} timeZone="Europe/Rome">
      <AccountsStep {...PROPS} {...props} />
    </NextIntlClientProvider>,
  );
}

const group = (legend: string) => screen.getByRole("group", { name: legend });
const targetOf = (legend: string) => group(legend).querySelector("select") as HTMLSelectElement;

beforeEach(() => {
  importAccounts.mockReset().mockResolvedValue({ ok: true });
  cancelConnection.mockReset().mockResolvedValue({ ok: true });
  push.mockReset();
});

describe("the choice of the accounts of a bank", () => {
  it("starts on a valid choice for every account, so one press imports them all", async () => {
    renderStep();
    expect(screen.getByRole("heading", { name: "Choose the accounts of Zeta Bank" })).toBeTruthy();
    expect(screen.getByText("The bank shared 2 accounts.")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Import 2 accounts" }));
    expect(importAccounts).toHaveBeenCalledWith("c-1", [
      {
        providerAccountId: "a-1",
        currency: "EUR",
        target: { kind: "new", name: "Zeta Bank Checking", type: "checking" },
      },
      {
        providerAccountId: "a-2",
        currency: "EUR",
        target: { kind: "new", name: "Zeta Bank Savings", type: "savings" },
      },
    ]);
    expect(push).toHaveBeenCalledWith("/banks/connect?step=done&c=c-1");
  });

  it("offers the person's own accounts of the same currency only, and says what happens to one", async () => {
    renderStep();
    const select = targetOf(PROPS.accounts[0].legend);
    expect([...select.options].map((option) => option.textContent)).toEqual([
      "Create a new account",
      'Use "Risparmi"',
      "Do not import",
    ]);
    await userEvent.selectOptions(select, "x-1");
    expect(
      screen.getByText(/the balance and the transactions of "Risparmi" come from the bank/),
    ).toBeTruthy();
    await userEvent.selectOptions(targetOf(PROPS.accounts[1].legend), "skip");
    await userEvent.click(screen.getByRole("button", { name: "Import 1 account" }));
    expect(importAccounts).toHaveBeenCalledWith("c-1", [
      { providerAccountId: "a-1", currency: "EUR", target: { kind: "existing", accountId: "x-1" } },
      { providerAccountId: "a-2", target: { kind: "skip" } },
    ]);
  });

  it("offers an archived account too, said archived, and says it comes back (H58)", async () => {
    renderStep({ existing: [{ id: "x-3", name: "Old", currency: "EUR", archived: true }] });
    const select = targetOf(PROPS.accounts[0].legend);
    expect([...select.options].map((option) => option.textContent)).toContain('Use "Old" (archived)');
    await userEvent.selectOptions(select, "x-3");
    expect(screen.getByText(/"Old" is archived: it comes back to the lists/)).toBeTruthy();
  });

  it("does not import the same account of the person twice", async () => {
    renderStep();
    await userEvent.selectOptions(targetOf(PROPS.accounts[0].legend), "x-1");
    await userEvent.selectOptions(targetOf(PROPS.accounts[1].legend), "x-1");
    expect(
      screen.getAllByText("This account is already chosen for another account of the bank."),
    ).toHaveLength(2);
    await userEvent.click(screen.getByRole("button", { name: "Import 2 accounts" }));
    expect(importAccounts).not.toHaveBeenCalled();
  });

  it("asks for at least one account, and for a name of a new one", async () => {
    renderStep();
    await userEvent.selectOptions(targetOf(PROPS.accounts[0].legend), "skip");
    await userEvent.selectOptions(targetOf(PROPS.accounts[1].legend), "skip");
    expect(screen.getByText("Choose at least one account.")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Import" }) as HTMLButtonElement).disabled).toBe(true);

    await userEvent.selectOptions(targetOf(PROPS.accounts[0].legend), "new");
    await userEvent.clear(screen.getByLabelText("Name"));
    await userEvent.click(screen.getByRole("button", { name: "Import 1 account" }));
    expect(screen.getByText("Enter a name for the account.")).toBeTruthy();
    expect(importAccounts).not.toHaveBeenCalled();
  });

  it("says so when the import fails, and keeps what was chosen", async () => {
    importAccounts.mockResolvedValue({ ok: false, error: "failed" });
    renderStep();
    await userEvent.selectOptions(targetOf(PROPS.accounts[1].legend), "skip");
    await userEvent.click(screen.getByRole("button", { name: "Import 1 account" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Couldn't import the accounts. Try again.");
    expect(targetOf(PROPS.accounts[1].legend).value).toBe("skip");
    expect(push).not.toHaveBeenCalled();
  });

  it("asks before it closes a first access, and only leaves the page for a renewal", async () => {
    renderStep();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    const dialog = screen.getByRole("dialog", { name: "Cancel the connection?" });
    expect(dialog.textContent).toContain("Access to Zeta Bank is closed and no account is created.");
    await userEvent.click(screen.getByRole("button", { name: "Cancel connection" }));
    expect(cancelConnection).toHaveBeenCalledWith("c-1");
    expect(push).toHaveBeenCalledWith("/settings/integrations");
  });

  it("shows the accounts already tied to the bank and does not ask about them", async () => {
    renderStep({
      accounts: [PROPS.accounts[1]],
      linked: [{ legend: "Conto · EUR", account: "Zeta Conto" }],
      cancellable: false,
    });
    expect(screen.getByText('Already linked to "Zeta Conto"')).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(cancelConnection).not.toHaveBeenCalled();
    expect(push).toHaveBeenCalledWith("/settings/integrations");
  });
});

describe("an account whose IBAN is already here (rewrite plan N4, H39)", () => {
  const withOwner = (owner: { id: string; name: string; manual: boolean }) => ({
    accounts: [{ ...PROPS.accounts[0], ibanOwner: owner }, PROPS.accounts[1]],
  });
  const legend = PROPS.accounts[0].legend;

  it("starts on the account kept by hand that has the IBAN, and offers no new account", () => {
    renderStep(withOwner({ id: "x-1", name: "Risparmi", manual: true }));
    expect(targetOf(legend).value).toBe("x-1");
    expect(within(group(legend)).getByRole("option", { name: "Create a new account" })).toBeDisabled();
    expect(within(group(legend)).getByRole("status")).toHaveTextContent(
      "This account is already in Ledgerly: “Risparmi” has the same IBAN.",
    );
  });

  it("is not imported when the account with the IBAN comes from another source", () => {
    renderStep(withOwner({ id: "w-1", name: "Current", manual: false }));
    expect(targetOf(legend).value).toBe("skip");
    expect(within(group(legend)).getByRole("status")).toHaveTextContent("“Current”, from another source");
  });

  it("says why when the server refuses an account with an IBAN already here", async () => {
    importAccounts.mockResolvedValueOnce({ ok: false, error: "iban_exists" });
    renderStep();
    await userEvent.click(screen.getByRole("button", { name: /Import/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "An account has the IBAN of an account already in Ledgerly",
    );
  });
});
