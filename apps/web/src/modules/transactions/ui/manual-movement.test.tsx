import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import messages from "../../../../../../messages/en.json";
import type { ManualCategoryOption } from "./manual-dialog";
import { AddMovementButton, ManualMovement } from "./manual-movement";
import type { ManualCommands, ManualSaveResult, ShownRange } from "./manual-types";
import { TransactionsTable } from "./transactions-table";
import type { GroupView, RowView } from "./view";

const push = vi.fn();
const replace = vi.fn();
const notify = vi.fn();
const setLabels = vi.fn();

vi.mock("next/navigation", () => ({ useRouter: () => ({ push, replace }) }));
vi.mock("@ledgerly/ui/router", async (original) => ({
  ...(await original<object>()),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@ledgerly/ui/toast", () => ({ notify: (...args: unknown[]) => notify(...args) }));
/** The page's own hide, restore and delete, which keeps the balance right. */
const visibility = vi.fn(async () => ({ ok: true as const, count: 1 }));

vi.mock("./commands", () => ({
  setCategory: vi.fn(),
  setNote: vi.fn(),
  setLabels: (...args: unknown[]) => setLabels(...args),
}));

const CATEGORIES: ManualCategoryOption[] = [
  { id: "cat-1", name: "Bars", color: "#2563eb", type: "expense" },
  { id: "cat-2", name: "Salary", color: "#047857", type: "income" },
];

const ACCOUNTS = [
  { id: "acc-cash", name: "Cash", currency: "EUR", mode: "manual" as const },
  { id: "acc-bank", name: "Zeta current", currency: "EUR", mode: "read_only" as const },
];

const SHOWN: ShownRange = { from: "2026-11-01", to: "2026-11-30", accountIds: [], narrowed: false };

const SAVED: ManualSaveResult = {
  ok: true,
  created: true,
  id: "tx-new",
  on: "2026-11-15",
  date: "15 Nov 2026",
  accountId: "acc-cash",
};

function commandsWith(overrides: Partial<ManualCommands> = {}): ManualCommands {
  return {
    form: vi.fn(async () => ({ accounts: ACCOUNTS, today: "2026-11-15" })),
    preview: vi.fn(async () => null),
    create: vi.fn(async () => SAVED),
    update: vi.fn(async () => ({ ...SAVED, created: false, id: "tx-manual" })),
    remove: vi.fn(async () => ({ ok: true as const, count: 1 })),
    ...overrides,
  };
}

const MANUAL_ROW: RowView = {
  id: "tx-manual",
  date: "14 Nov 2026",
  payee: "Corner bar",
  account: "Cash",
  categoryId: "cat-1",
  categoryName: "Bars",
  categoryColor: "#2563eb",
  amount: "−4,50 €",
  amountTone: "neg",
  badges: ["manual"],
  hidden: false,
  note: null,
  labels: [],
  labelIds: [],
  manual: { kind: "expense", amount: "4,50", on: "2026-11-14", accountId: "acc-cash", payee: "Corner bar" },
};

const GROUPS: GroupView[] = [
  { key: "2026-11-01", label: "November 2026", count: 1, total: "−4,50 €", rows: [MANUAL_ROW] },
];

function renderScreen(commands: ManualCommands, options: { shown?: ShownRange; openOnMount?: boolean } = {}) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages} timeZone="Europe/Rome">
      <ManualMovement
        commands={commands}
        categories={CATEGORIES}
        labels={[]}
        shown={options.shown ?? SHOWN}
        openOnMount={options.openOnMount}
      >
        <AddMovementButton />
        <TransactionsTable
          groups={GROUPS}
          categories={CATEGORIES}
          labels={[]}
          params={{}}
          sort="date"
          direction="desc"
          visibility={visibility}
        />
      </ManualMovement>
    </NextIntlClientProvider>,
  );
}

async function openDialog(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Add transaction" }));
  const dialog = await screen.findByRole("dialog");
  await waitFor(() => expect(within(dialog).getByLabelText("Account")).toBeEnabled());
  return within(dialog);
}

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
});

describe("the manual movement's dialog", () => {
  it("offers the accounts by mode and starts from the first one kept by hand, today", async () => {
    const user = userEvent.setup();
    renderScreen(commandsWith());
    const dialog = await openDialog(user);

    expect(dialog.getByRole("group", { name: "Accounts kept by hand" })).toBeInTheDocument();
    expect(dialog.getByRole("group", { name: "Accounts connected to a bank" })).toBeInTheDocument();
    expect(dialog.getByLabelText("Account")).toHaveValue("acc-cash");
    expect(dialog.getByLabelText("Date")).toHaveValue("2026-11-15");
    expect(dialog.getByLabelText("Date")).toHaveAttribute("max", "2026-11-15");
    expect(dialog.queryByTestId("manual-bank-warning")).not.toBeInTheDocument();
  });

  it("warns on an account a bank reads, without stopping the save", async () => {
    const user = userEvent.setup();
    renderScreen(commandsWith());
    const dialog = await openDialog(user);

    await user.selectOptions(dialog.getByLabelText("Account"), "acc-bank");

    expect(dialog.getByTestId("manual-bank-warning")).toHaveTextContent(
      "This account gets its transactions from the bank. A transaction added by hand can appear twice.",
    );
    expect(dialog.getByRole("button", { name: "Add transaction" })).toBeEnabled();
  });

  it("sends the fields with the key of this opening, and says the movement was added", async () => {
    const user = userEvent.setup();
    const commands = commandsWith();
    renderScreen(commands);
    const dialog = await openDialog(user);

    await user.type(dialog.getByLabelText("Amount"), "4,50");
    await user.type(dialog.getByLabelText("Payee (optional)"), "Corner bar");
    await user.click(dialog.getByRole("button", { name: "Add transaction" }));

    await waitFor(() => expect(commands.create).toHaveBeenCalledTimes(1));
    const [form, key] = vi.mocked(commands.create).mock.calls[0];
    expect(form).toEqual({
      kind: "expense",
      amount: "4,50",
      on: "2026-11-15",
      accountId: "acc-cash",
      categoryId: null,
      payee: "Corner bar",
      note: "",
    });
    expect(key).toMatch(/^[0-9a-f-]{36}$/);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(notify).toHaveBeenCalledWith("Transaction added");
  });

  it("sends one request for a double click, and a new key for a new opening", async () => {
    const user = userEvent.setup();
    let finish: (result: ManualSaveResult) => void = () => {};
    const create = vi.fn<ManualCommands["create"]>(
      () => new Promise<ManualSaveResult>((resolve) => (finish = resolve)),
    );
    const commands = commandsWith({ create });
    renderScreen(commands);
    const dialog = await openDialog(user);
    await user.type(dialog.getByLabelText("Amount"), "4,50");

    const submit = dialog.getByRole("button", { name: "Add transaction" });
    await user.dblClick(submit);
    expect(create).toHaveBeenCalledTimes(1);
    expect(dialog.getByRole("button", { name: "Saving…" })).toBeDisabled();
    finish(SAVED);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    const again = await openDialog(user);
    await user.type(again.getByLabelText("Amount"), "1");
    await user.click(again.getByRole("button", { name: "Add transaction" }));
    await waitFor(() => expect(create).toHaveBeenCalledTimes(2));
    expect(create.mock.calls[1][1]).not.toBe(create.mock.calls[0][1]);
  });

  it("keeps the same key when the save fails and the person tries again", async () => {
    const user = userEvent.setup();
    const create = vi
      .fn<ManualCommands["create"]>()
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce(SAVED);
    renderScreen(commandsWith({ create }));
    const dialog = await openDialog(user);
    await user.type(dialog.getByLabelText("Amount"), "4,50");

    await user.click(dialog.getByRole("button", { name: "Add transaction" }));
    expect(await dialog.findByRole("alert")).toHaveTextContent("Couldn't save. Try again.");
    expect(dialog.getByLabelText("Amount")).toHaveValue("4,50");

    await user.click(await dialog.findByRole("button", { name: "Add transaction" }));
    await waitFor(() => expect(create).toHaveBeenCalledTimes(2));
    expect(create.mock.calls[1][1]).toBe(create.mock.calls[0][1]);
  });

  it("asks for an amount before it sends anything", async () => {
    const user = userEvent.setup();
    const commands = commandsWith();
    renderScreen(commands);
    const dialog = await openDialog(user);

    await user.click(dialog.getByRole("button", { name: "Add transaction" }));

    expect(dialog.getByText("Enter an amount greater than zero.")).toBeInTheDocument();
    expect(dialog.getByLabelText("Amount")).toHaveFocus();
    expect(commands.create).not.toHaveBeenCalled();
  });

  it("shows the server's refusal of the amount under the field", async () => {
    const user = userEvent.setup();
    renderScreen(
      commandsWith({ create: vi.fn(async () => ({ ok: false as const, error: "amount" as const })) }),
    );
    const dialog = await openDialog(user);
    await user.type(dialog.getByLabelText("Amount"), "abc");
    await user.click(dialog.getByRole("button", { name: "Add transaction" }));
    expect(await dialog.findByText("Enter an amount greater than zero.")).toBeInTheDocument();
    expect(await dialog.findByRole("button", { name: "Add transaction" })).toBeEnabled();
  });

  it("shows the balance line the server worked out, a little after the last key", async () => {
    const user = userEvent.setup();
    const preview = vi.fn(async () => ({
      kind: "change" as const,
      account: "Cash",
      before: "80,00 €",
      after: "75,50 €",
    }));
    renderScreen(commandsWith({ preview }));
    const dialog = await openDialog(user);

    await user.type(dialog.getByLabelText("Amount"), "4,50");

    expect(await dialog.findByTestId("manual-balance-line")).toHaveTextContent(
      "Balance of “Cash”: from 80,00 € to 75,50 €.",
    );
    // One request for the whole amount, not one for each key.
    expect(preview).toHaveBeenCalledTimes(1);
    expect(preview).toHaveBeenCalledWith({
      kind: "expense",
      amount: "4,50",
      on: "2026-11-15",
      accountId: "acc-cash",
      editingId: undefined,
    });
  });

  it("offers the categories of the kind chosen, and drops one of the other kind", async () => {
    const user = userEvent.setup();
    const commands = commandsWith();
    renderScreen(commands);
    const dialog = await openDialog(user);

    await user.click(dialog.getByRole("button", { name: "Category" }));
    await user.click(await screen.findByRole("option", { name: "Bars" }));
    expect(dialog.getByRole("button", { name: "Category" })).toHaveTextContent("Bars");

    await user.click(dialog.getByRole("button", { name: "Money in" }));
    expect(dialog.getByRole("button", { name: "Category" })).toHaveTextContent("To categorise");
    await user.click(dialog.getByRole("button", { name: "Category" }));
    expect(await screen.findByRole("option", { name: "Salary" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Bars" })).not.toBeInTheDocument();
  });

  it("says where a movement outside the list went, with a way to see it", async () => {
    const user = userEvent.setup();
    renderScreen(commandsWith(), { shown: { ...SHOWN, from: "2026-10-01", to: "2026-10-31" } });
    const dialog = await openDialog(user);
    await user.type(dialog.getByLabelText("Amount"), "4,50");
    await user.click(dialog.getByRole("button", { name: "Add transaction" }));

    await waitFor(() => expect(notify).toHaveBeenCalled());
    const [message, tone, action] = notify.mock.calls[0];
    expect(message).toBe("Transaction added on 15 Nov 2026, outside what you see now");
    expect(tone).toBe("success");
    expect(action.label).toBe("Show");
    action.onClick();
    expect(push).toHaveBeenCalledWith("/expenses?from=2026-11-01&to=2026-11-30");
  });

  it("says an account is needed when none takes a manual movement", async () => {
    const user = userEvent.setup();
    renderScreen(commandsWith({ form: vi.fn(async () => ({ accounts: [], today: "2026-11-15" })) }));
    await user.click(screen.getByRole("button", { name: "Add transaction" }));

    const dialog = within(await screen.findByRole("dialog"));
    expect(await dialog.findByText("You need an account")).toBeInTheDocument();
    expect(dialog.getByRole("link", { name: "Create an account" })).toHaveAttribute("href", "/accounts/new");
  });

  it("opens by itself for the palette's command, and cleans the address", async () => {
    renderScreen(commandsWith(), { openOnMount: true });
    expect(await screen.findByRole("dialog", { name: "Add transaction" })).toBeInTheDocument();
    expect(replace).toHaveBeenCalledWith("/expenses");
  });
});

describe("a manual movement in the table", () => {
  it("carries the badge and its own menu: change, hide, delete", async () => {
    const user = userEvent.setup();
    renderScreen(commandsWith());
    const table = within(screen.getByRole("table"));

    expect(table.getByText("Manual")).toBeInTheDocument();
    await user.click(table.getByRole("button", { name: "Row actions" }));
    expect((await screen.findAllByRole("menuitem")).map((item) => item.textContent)).toEqual([
      "Edit category",
      "Edit transaction",
      "Hide",
      "Delete",
    ]);
  });

  it("opens the dialog with the movement's own fields, and saves the change", async () => {
    const user = userEvent.setup();
    const commands = commandsWith();
    renderScreen(commands);
    await user.click(within(screen.getByRole("table")).getByRole("button", { name: "Row actions" }));
    await user.click(await screen.findByRole("menuitem", { name: "Edit transaction" }));

    const dialog = within(await screen.findByRole("dialog", { name: "Edit transaction" }));
    await waitFor(() => expect(dialog.getByLabelText("Account")).toBeEnabled());
    expect(dialog.getByLabelText("Amount")).toHaveValue("4,50");
    expect(dialog.getByLabelText("Date")).toHaveValue("2026-11-14");
    expect(dialog.getByLabelText("Payee (optional)")).toHaveValue("Corner bar");

    await user.clear(dialog.getByLabelText("Amount"));
    await user.type(dialog.getByLabelText("Amount"), "10");
    await user.click(dialog.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(commands.update).toHaveBeenCalledTimes(1));
    expect(vi.mocked(commands.update).mock.calls[0][0]).toBe("tx-manual");
    expect(vi.mocked(commands.update).mock.calls[0][1]).toMatchObject({ amount: "10", on: "2026-11-14" });
    expect(commands.create).not.toHaveBeenCalled();
    await waitFor(() => expect(notify).toHaveBeenCalledWith("Transaction saved"));
  });

  it("asks before it deletes, and deletes without hiding first", async () => {
    const user = userEvent.setup();
    const commands = commandsWith();
    renderScreen(commands);
    await user.click(within(screen.getByRole("table")).getByRole("button", { name: "Row actions" }));
    await user.click(await screen.findByRole("menuitem", { name: "Delete" }));

    const dialog = within(await screen.findByRole("dialog", { name: "Delete this transaction?" }));
    expect(
      dialog.getByText("You added it by hand on 14 Nov 2026. It is removed permanently."),
    ).toBeInTheDocument();
    expect(commands.remove).not.toHaveBeenCalled();

    await user.click(dialog.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(commands.remove).toHaveBeenCalledWith("tx-manual"));
    await waitFor(() => expect(notify).toHaveBeenCalledWith("1 transaction deleted", "success"));
  });

  it("hides through the page's own write, which keeps the balance right", async () => {
    const user = userEvent.setup();
    const commands = commandsWith();
    renderScreen(commands);
    await user.click(within(screen.getByRole("table")).getByRole("button", { name: "Row actions" }));
    await user.click(await screen.findByRole("menuitem", { name: "Hide" }));

    await waitFor(() => expect(visibility).toHaveBeenCalledWith(["tx-manual"], "hide"));
  });
});
