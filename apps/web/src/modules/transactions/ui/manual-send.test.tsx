import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import messages from "../../../../../../messages/en.json";
import { AddMovementButton, ManualMovement } from "./manual-movement";
import type { ManualAccountView, ManualCommands } from "./manual-types";
import { TransactionsTable } from "./transactions-table";
import type { RowView } from "./view";

// The manual movement on an account whose source takes it (ux/n3-categories-manual.md §9.8): the
// notes of the dialog, the state on the row, and "Retry sending".

const notify = vi.fn();

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));
vi.mock("@ledgerly/ui/router", async (original) => ({
  ...(await original<object>()),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@ledgerly/ui/toast", () => ({ notify: (...args: unknown[]) => notify(...args) }));
vi.mock("./commands", () => ({
  setCategory: vi.fn(),
  setNote: vi.fn(),
  setLabels: vi.fn(),
}));

const ACCOUNTS: ManualAccountView[] = [
  { id: "acc-cash", name: "Cash", currency: "EUR", mode: "manual" },
  {
    id: "acc-app",
    name: "Budget current",
    currency: "EUR",
    mode: "two_way",
    source: { name: "Pursely", waiting: false },
  },
  {
    id: "acc-old",
    name: "Budget savings",
    currency: "EUR",
    mode: "two_way",
    source: { name: "Pursely", waiting: true },
  },
  { id: "acc-bank", name: "Zeta current", currency: "EUR", mode: "read_only" },
];

function commandsWith(overrides: Partial<ManualCommands> = {}): ManualCommands {
  return {
    form: vi.fn(async () => ({ accounts: ACCOUNTS, today: "2026-11-15" })),
    preview: vi.fn(async () => null),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(async () => ({ ok: true as const, count: 1 })),
    ...overrides,
  };
}

function row(send: RowView["send"]): RowView {
  return {
    id: "tx-manual",
    date: "14 Nov 2026",
    payee: "Corner bar",
    account: "Budget current",
    categoryId: null,
    categoryName: null,
    categoryColor: null,
    amount: "−4,50 €",
    amountTone: "neg",
    badges: ["manual"],
    hidden: false,
    note: null,
    labels: [],
    labelIds: [],
    manual: { kind: "expense", amount: "4,50", on: "2026-11-14", accountId: "acc-app", payee: "Corner bar" },
    send,
  };
}

function renderScreen(commands: ManualCommands, send: RowView["send"] = null) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages} timeZone="Europe/Rome">
      <ManualMovement
        commands={commands}
        categories={[]}
        labels={[]}
        shown={{ from: "2026-11-01", to: "2026-11-30", accountIds: [], narrowed: false }}
      >
        <AddMovementButton />
        <TransactionsTable
          groups={[
            { key: "2026-11-01", label: "November 2026", count: 1, total: "−4,50 €", rows: [row(send)] },
          ]}
          categories={[]}
          labels={[]}
          params={{}}
          sort="date"
          direction="desc"
          visibility={vi.fn()}
        />
      </ManualMovement>
    </NextIntlClientProvider>,
  );
}

async function openDialog(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Add transaction" }));
  const dialog = await screen.findByRole("dialog");
  await waitFor(() => expect(within(dialog).getByLabelText("Account")).toBeEnabled());
  return dialog;
}

beforeEach(() => notify.mockClear());

describe("the dialog on an account whose source takes the movement", () => {
  it("lists such accounts under the name of their source, between the two other groups", async () => {
    const user = userEvent.setup();
    renderScreen(commandsWith());
    const dialog = await openDialog(user);
    const groups = within(dialog)
      .getAllByRole("group")
      .map((group) => group.getAttribute("label"))
      .filter((label) => label !== null);
    expect(groups).toEqual([
      "Accounts kept by hand",
      "Accounts connected to Pursely",
      "Accounts connected to a bank",
    ]);
  });

  it("says the movement goes to the source at the next update, and nothing on an account kept by hand", async () => {
    const user = userEvent.setup();
    renderScreen(commandsWith());
    const dialog = await openDialog(user);
    expect(within(dialog).queryByTestId("manual-send-note")).toBeNull();

    await user.selectOptions(within(dialog).getByLabelText("Account"), "acc-app");
    expect(within(dialog).getByTestId("manual-send-note")).toHaveTextContent(
      "Ledgerly sends this transaction to Pursely at the next update.",
    );
    expect(within(dialog).queryByTestId("manual-bank-warning")).toBeNull();
  });

  it("says the movement waits when the connection is not updated now", async () => {
    const user = userEvent.setup();
    renderScreen(commandsWith());
    const dialog = await openDialog(user);
    await user.selectOptions(within(dialog).getByLabelText("Account"), "acc-old");
    expect(within(dialog).getByTestId("manual-send-note")).toHaveTextContent(
      "Pursely is not updated now. Ledgerly sends this transaction when the connection resumes.",
    );
  });
});

describe("the row of a movement that waits for its source", () => {
  it("says 'To send' beside 'Manual', and offers no retry yet", async () => {
    const user = userEvent.setup();
    renderScreen(commandsWith({ retrySend: vi.fn() }), { state: "to_send", source: "Pursely" });
    const table = screen.getByRole("table");
    expect(within(table).getByText("Manual")).toBeInTheDocument();
    expect(within(table).getByText("To send")).toBeInTheDocument();

    await user.click(within(table).getByRole("button", { name: "Row actions" }));
    expect(await screen.findByRole("menuitem", { name: "Edit transaction" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Retry sending" })).toBeNull();
  });

  it("says which source did not take it, and retries from the row's menu", async () => {
    const user = userEvent.setup();
    const retrySend = vi.fn(async () => ({ ok: true as const, sent: true }));
    renderScreen(commandsWith({ retrySend }), { state: "not_sent", source: "Pursely" });
    const table = screen.getByRole("table");
    expect(within(table).getByText("Not sent to Pursely")).toBeInTheDocument();

    await user.click(within(table).getByRole("button", { name: "Row actions" }));
    await user.click(await screen.findByRole("menuitem", { name: "Retry sending" }));
    await waitFor(() => expect(retrySend).toHaveBeenCalledWith("tx-manual"));
    // The row says what happened: no toast for one movement.
    expect(notify).not.toHaveBeenCalled();
  });

  it("says the retry could not be made", async () => {
    const user = userEvent.setup();
    const retrySend = vi.fn(async () => ({ ok: false as const }));
    renderScreen(commandsWith({ retrySend }), { state: "not_sent", source: "Pursely" });
    await user.click(within(screen.getByRole("table")).getByRole("button", { name: "Row actions" }));
    await user.click(await screen.findByRole("menuitem", { name: "Retry sending" }));
    await waitFor(() => expect(notify).toHaveBeenCalledWith(messages.expenses.errors.failed, "error"));
  });

  it("shows no state on a manual movement that waits for nothing", () => {
    renderScreen(commandsWith({ retrySend: vi.fn() }), null);
    const table = screen.getByRole("table");
    expect(within(table).queryByText("To send")).toBeNull();
    expect(within(table).queryByText(/Not sent to/)).toBeNull();
  });
});
