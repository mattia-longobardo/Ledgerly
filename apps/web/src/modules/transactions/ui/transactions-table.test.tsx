import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";
import messages from "../../../../../../messages/en.json";
import { TransactionsTable } from "./transactions-table";
import type { CategoryOption, GroupView, LabelOption, RowView } from "./view";

const push = vi.fn();
const setCategory = vi.fn();
const hide = vi.fn();
const restore = vi.fn();
const removeHidden = vi.fn();
/** The page's action, one change at a time, so each test reads the change it made. */
const visibility = (ids: string[], change: "hide" | "restore" | "delete") =>
  ({ hide, restore, delete: removeHidden })[change](ids);
const setNote = vi.fn();
const setLabels = vi.fn();
const setTransferSide = vi.fn();
const notify = vi.fn();

vi.mock("@ledgerly/ui/router", () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }));

vi.mock("./commands", () => ({
  setCategory: (...args: unknown[]) => setCategory(...args),
  setNote: (...args: unknown[]) => setNote(...args),
  setLabels: (...args: unknown[]) => setLabels(...args),
  setTransferSide: (...args: unknown[]) => setTransferSide(...args),
}));

vi.mock("@ledgerly/ui/toast", () => ({ notify: (...args: unknown[]) => notify(...args) }));

const LABELS: LabelOption[] = [
  { id: "lab-1", name: "subscriptions", color: "#b45309" },
  { id: "lab-2", name: "work", color: null },
];

const CATEGORIES: CategoryOption[] = [
  { id: "cat-1", name: "Groceries", color: "#2563eb" },
  { id: "cat-2", name: "Rent", color: "#047857" },
];

const NETFLIX: RowView = {
  id: "tx-1",
  date: "11 Sep 2026",
  payee: "Netflix",
  account: "Revolut Main",
  categoryId: "cat-1",
  categoryName: "Groceries",
  categoryColor: "#2563eb",
  amount: "−12,99 €",
  amountTone: "neg",
  badges: ["edited"],
  hidden: false,
  note: "family plan",
  labels: ["subscriptions"],
  labelIds: ["lab-1"],
};

const GONE: RowView = {
  id: "tx-2",
  date: "9 Sep 2026",
  payee: null,
  account: "ING Conto Arancio",
  categoryId: null,
  categoryName: null,
  categoryColor: null,
  amount: "−4,00 €",
  amountTone: "neg",
  badges: ["hidden", "removedUpstream"],
  hidden: true,
  note: null,
  labels: [],
  labelIds: [],
};

const GROUPS: GroupView[] = [
  { key: "2026-09-01", label: "September 2026", count: 2, total: "−16,99 €", rows: [NETFLIX, GONE] },
];

/** The dialog's own actions, under the form: what the row's menu offered before. */
function actionsOf(dialog: HTMLElement): HTMLElement {
  return within(dialog).getByRole("region", { name: "Other actions" });
}

function renderTable(groups: GroupView[] = GROUPS) {
  render(
    <NextIntlClientProvider locale="en" messages={messages} timeZone="Europe/Rome">
      <TransactionsTable
        groups={groups}
        categories={CATEGORIES}
        labels={LABELS}
        params={{ preset: "lastMonth" }}
        sort="date"
        direction="desc"
        visibility={visibility}
      />
    </NextIntlClientProvider>,
  );
  return within(screen.getByRole("table"));
}

describe("TransactionsTable", () => {
  it("draws the design's row: date, payee, account, category, amount", () => {
    const table = renderTable();
    expect(table.getByText("11 Sep 2026")).toBeInTheDocument();
    expect(table.getByText("Netflix")).toBeInTheDocument();
    expect(table.getByText("Revolut Main")).toBeInTheDocument();
    expect(table.getByText("Groceries")).toBeInTheDocument();
    expect(table.getByText("−12,99 €")).toBeInTheDocument();
    expect(table.getByText("family plan")).toBeInTheDocument();
    expect(table.getByText("subscriptions")).toBeInTheDocument();
  });

  it("heads each month with its own count and total", () => {
    const table = renderTable();
    expect(table.getByText("September 2026")).toBeInTheDocument();
    expect(table.getByText("2 transactions · −16,99 €")).toBeInTheDocument();
  });

  it("says a month's total is partial only when it left movements out for want of a rate (D4)", () => {
    const table = renderTable([{ ...GROUPS[0], excludedCount: 2 }]);
    expect(
      table.getByText(
        "2 transactions · −16,99 € · Partial total: 2 foreign-currency transactions without an exchange rate left out",
      ),
    ).toBeInTheDocument();
  });

  it("says nothing of a partial total when no movement was left out", () => {
    const table = renderTable();
    expect(table.queryByText(/Partial total/)).not.toBeInTheDocument();
  });

  it("names a movement with no payee and no category rather than leaving a blank", () => {
    const table = renderTable();
    expect(table.getByText("No payee")).toBeInTheDocument();
    expect(table.getByText("To categorise")).toBeInTheDocument();
  });

  it("badges what keeps a row out of the totals and what the user changed", () => {
    const table = renderTable();
    expect(table.getByText("Edited here")).toBeInTheDocument();
    expect(table.getByText("Hidden")).toBeInTheDocument();
    expect(table.getByText("Gone from source")).toBeInTheDocument();
  });

  it("shows no action bar until something is selected", () => {
    renderTable();
    expect(screen.queryByText("1 selected")).not.toBeInTheDocument();
  });

  it("hides the selected rows, which is what the design's Delete means", async () => {
    hide.mockResolvedValue({ ok: true, count: 1 });
    const table = renderTable();
    await userEvent.click(table.getByRole("checkbox", { name: "Netflix" }));
    expect(screen.getByText("1 selected")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Hide" }));
    expect(hide).toHaveBeenCalledWith(["tx-1"]);
    expect(notify).toHaveBeenCalledWith("1 transaction hidden");
  });

  it("offers to restore instead, once every selected row is already hidden", async () => {
    restore.mockResolvedValue({ ok: true, count: 1 });
    const table = renderTable();
    await userEvent.click(table.getByRole("checkbox", { name: "No payee" }));
    await userEvent.click(screen.getByRole("button", { name: "Restore" }));
    expect(restore).toHaveBeenCalledWith(["tx-2"]);
    expect(notify).toHaveBeenCalledWith("1 transaction restored");
  });

  it("offers Delete under Restore on a hidden row only, and deletes after a confirmation", async () => {
    removeHidden.mockResolvedValue({ ok: true, count: 1 });
    const table = renderTable();
    await userEvent.click(table.getByText("Netflix"));
    expect(
      within(actionsOf(screen.getByRole("dialog"))).queryByRole("button", { name: "Delete" }),
    ).not.toBeInTheDocument();
    await userEvent.keyboard("{Escape}");

    await userEvent.click(table.getByText("No payee"));
    const actions = within(actionsOf(screen.getByRole("dialog")));
    const items = actions.getAllByRole("button").map((item) => item.textContent);
    expect(items.slice(-2)).toEqual(["Restore", "Delete"]);
    await userEvent.click(actions.getByRole("button", { name: "Delete" }));
    const dialog = screen.getByRole("dialog", { name: "Delete this transaction?" });
    expect(removeHidden).not.toHaveBeenCalled();
    await userEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
    expect(removeHidden).toHaveBeenCalledWith(["tx-2"]);
    expect(notify).toHaveBeenCalledWith("1 transaction deleted");
  });

  it("selects and clears every row at once", async () => {
    renderTable();
    const table = within(screen.getByRole("table"));
    await userEvent.click(table.getByRole("checkbox", { name: "Select all" }));
    expect(screen.getByText("2 selected")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(screen.queryByText("2 selected")).not.toBeInTheDocument();
  });

  it("sets the category of a row from the chip on it", async () => {
    setCategory.mockResolvedValue({ ok: true, count: 1 });
    const table = renderTable();
    const chips = table.getAllByRole("button", { name: "Edit category" });
    await userEvent.click(chips[0]);
    await userEvent.click(await screen.findByRole("option", { name: "Rent" }));
    expect(setCategory).toHaveBeenCalledWith(["tx-1"], "cat-2");
  });

  it("says why a refusal happened instead of pretending it saved", async () => {
    hide.mockResolvedValue({ ok: false, error: "not_found" });
    const table = renderTable();
    await userEvent.click(table.getByRole("checkbox", { name: "Netflix" }));
    await userEvent.click(screen.getByRole("button", { name: "Hide" }));
    expect(notify).toHaveBeenCalledWith("That transaction no longer exists.", "error");
  });

  it("sorts by navigating, so the answer stays in the URL", async () => {
    const table = renderTable();
    await userEvent.click(table.getByRole("button", { name: /Amount/ }));
    expect(push).toHaveBeenCalledWith("/expenses?preset=lastMonth&sort=amount");
  });

  it("orders every column of the design, each starting in its own direction", async () => {
    const table = renderTable();
    // A name reads A to Z, which is the default, so the address carries no direction.
    await userEvent.click(table.getByRole("button", { name: /Account/ }));
    expect(push).toHaveBeenCalledWith("/expenses?preset=lastMonth&sort=account");
    await userEvent.click(table.getByRole("button", { name: /Category/ }));
    expect(push).toHaveBeenCalledWith("/expenses?preset=lastMonth&sort=category");
    // Clicking the column already sorted turns it round.
    await userEvent.click(table.getByRole("button", { name: /Date/ }));
    expect(push).toHaveBeenCalledWith("/expenses?preset=lastMonth&dir=asc");
  });

  it("answers the shortcuts the card promises: J and K move, Space selects", async () => {
    renderTable();
    await userEvent.keyboard("j");
    await userEvent.keyboard(" ");
    expect(screen.getByText("1 selected")).toBeInTheDocument();
    await userEvent.keyboard("j");
    await userEvent.keyboard(" ");
    expect(screen.getByText("2 selected")).toBeInTheDocument();
    await userEvent.keyboard("k");
    await userEvent.keyboard(" ");
    expect(screen.getByText("1 selected")).toBeInTheDocument();
  });

  it("opens the category editor of the row under the cursor on E", async () => {
    renderTable();
    await userEvent.keyboard("j");
    await userEvent.keyboard("e");
    expect(await screen.findByRole("option", { name: "Groceries" })).toBeInTheDocument();
  });

  it("announces the direction one more click would order by, column by column", () => {
    // The list is in date order, biggest first, so Date turns round and every other column
    // starts in its own natural direction: A to Z for a name, biggest first for an amount.
    const table = renderTable();
    expect(table.getByRole("button", { name: "Date Sort ascending" })).toBeInTheDocument();
    expect(table.getByRole("button", { name: "Payee Sort ascending" })).toBeInTheDocument();
    expect(table.getByRole("button", { name: "Account Sort ascending" })).toBeInTheDocument();
    expect(table.getByRole("button", { name: "Category Sort ascending" })).toBeInTheDocument();
    expect(table.getByRole("button", { name: "Amount Sort descending" })).toBeInTheDocument();
  });

  it("leaves Space to the button under the focus instead of selecting a row", async () => {
    // Space is how a button is pressed: eating it would open no menu and select a row the
    // reader never pointed at.
    const table = renderTable();
    await userEvent.keyboard("j");
    table.getAllByRole("button", { name: "Edit category" })[0].focus();
    await userEvent.keyboard(" ");
    expect(screen.queryByText("1 selected")).not.toBeInTheDocument();

    table.getAllByRole("button", { name: /Sort/ })[0].focus();
    await userEvent.keyboard(" ");
    expect(screen.queryByText("1 selected")).not.toBeInTheDocument();

    table.getByRole("button", { name: /Amount/ }).focus();
    await userEvent.keyboard(" ");
    expect(screen.queryByText("1 selected")).not.toBeInTheDocument();
    expect(push).toHaveBeenCalledWith("/expenses?preset=lastMonth&sort=amount");
  });

  it("leaves the shortcuts alone while the caret is in a field", async () => {
    render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="Europe/Rome">
        <input aria-label="search" />
        <TransactionsTable
          groups={GROUPS}
          categories={CATEGORIES}
          labels={LABELS}
          params={{}}
          sort="date"
          direction="desc"
          visibility={visibility}
        />
      </NextIntlClientProvider>,
    );
    await userEvent.type(screen.getByLabelText("search"), "j e");
    expect(screen.queryByText("1 selected")).not.toBeInTheDocument();
    expect(screen.getByLabelText("search")).toHaveValue("j e");
  });

  it("opens the edit dialog from a click on the row, with the provider's fields as context", async () => {
    const table = renderTable();
    await userEvent.click(table.getByText("Netflix"));
    const panel = screen.getByRole("dialog");
    expect(within(panel).getByLabelText("Note")).toHaveValue("family plan");
    expect(within(panel).getByLabelText("subscriptions")).toBeChecked();
    expect(within(panel).getByLabelText("work")).not.toBeChecked();
    // Payee, amount and date belong to the provider: shown, never offered as fields.
    expect(within(panel).getByText("Netflix")).toBeInTheDocument();
    expect(within(panel).getByText("−12,99 €")).toBeInTheDocument();
    expect(within(panel).queryByLabelText("Payee")).not.toBeInTheDocument();
  });

  it("opens the same dialog on Enter and on a double click, and not from a control of the row", async () => {
    const table = renderTable();
    const row = table.getAllByRole("row").find((one) => within(one).queryByText("Netflix"))!;
    await userEvent.dblClick(within(row).getByText("Netflix"));
    expect(within(screen.getByRole("dialog")).getByLabelText("Note")).toHaveValue("family plan");

    await userEvent.keyboard("{Escape}");
    // The focus goes back to the row it was opened from.
    expect(row).toHaveFocus();
    await userEvent.keyboard("{Enter}");
    expect(within(screen.getByRole("dialog")).getByLabelText("Note")).toHaveValue("family plan");

    await userEvent.keyboard("{Escape}");
    // The checkbox is the checkbox's: a double click there ticks it and opens nothing.
    await userEvent.dblClick(within(row).getByRole("checkbox"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  async function openDetails() {
    await userEvent.click(within(screen.getByRole("table")).getByText("Netflix"));
    return screen.getByRole("dialog");
  }

  it("saves the note and the labels through their own actions", async () => {
    setNote.mockResolvedValue({ ok: true });
    setLabels.mockResolvedValue({ ok: true });
    renderTable();
    const panel = await openDetails();
    await userEvent.clear(within(panel).getByLabelText("Note"));
    await userEvent.type(within(panel).getByLabelText("Note"), "cancelled");
    await userEvent.click(within(panel).getByLabelText("work"));
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(setNote).toHaveBeenCalledWith("tx-1", "cancelled");
    expect(setLabels).toHaveBeenCalledWith("tx-1", ["lab-1", "lab-2"]);
    expect(notify).toHaveBeenCalledWith("Note saved");
    expect(notify).toHaveBeenCalledWith("Labels saved");
  });

  it("writes nothing when the panel is saved untouched, so it claims no local edit", async () => {
    renderTable();
    await openDetails();
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(setNote).not.toHaveBeenCalled();
    expect(setLabels).not.toHaveBeenCalled();
  });

  it("keeps the panel open and says why when a save is refused", async () => {
    setNote.mockResolvedValue({ ok: false, error: "provider_owned" });
    renderTable();
    const panel = await openDetails();
    await userEvent.type(within(panel).getByLabelText("Note"), " more");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Payee, amount and date belong to the source and cannot be edited here.",
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("drops the month heading when the list is not in date order", () => {
    render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="Europe/Rome">
        <TransactionsTable
          groups={[{ key: "all", label: null, count: 2, total: "−16,99 €", rows: [NETFLIX, GONE] }]}
          categories={CATEGORIES}
          labels={LABELS}
          params={{}}
          sort="amount"
          direction="desc"
          visibility={visibility}
        />
      </NextIntlClientProvider>,
    );
    expect(screen.queryByText("September 2026")).not.toBeInTheDocument();
    expect(within(screen.getByRole("table")).getByText("Netflix")).toBeInTheDocument();
  });
});

describe("the edit dialog's type", () => {
  const GIROCONTO: RowView = {
    ...NETFLIX,
    id: "tx-3",
    payee: "To savings",
    categoryId: null,
    categoryName: null,
    categoryColor: null,
    macros: [],
    accountId: "acc-1",
    transfer: { state: "paired", otherId: "acc-2", other: "Savings", out: true },
    labelIds: [],
    labels: [],
    note: null,
  };
  const SPENDING: RowView = { ...NETFLIX, macros: ["expense"], accountId: "acc-1" };
  const TYPED: CategoryOption[] = [
    { id: "cat-1", name: "Groceries", color: "#2563eb", type: "expense" },
    { id: "cat-9", name: "Salary", color: "#047857", type: "income" },
  ];

  function renderOne(row: RowView) {
    render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="Europe/Rome">
        <TransactionsTable
          groups={[{ key: "all", label: null, count: 1, total: row.amount, rows: [row] }]}
          categories={TYPED}
          labels={LABELS}
          params={{}}
          sort="date"
          direction="desc"
          visibility={visibility}
          accounts={[
            { id: "acc-1", name: "Revolut Main" },
            { id: "acc-2", name: "Savings" },
          ]}
        />
      </NextIntlClientProvider>,
    );
  }

  it("turns a giroconto into a spending with its category in one save", async () => {
    setTransferSide.mockResolvedValue({ ok: true });
    setCategory.mockResolvedValue({ ok: true, count: 1 });
    renderOne(GIROCONTO);
    await userEvent.click(within(screen.getByRole("table")).getByText("To savings"));
    const dialog = within(screen.getByRole("dialog"));
    await userEvent.click(dialog.getByRole("button", { name: "Expense" }));
    await userEvent.click(dialog.getByRole("button", { name: "Edit category" }));
    await userEvent.click(await screen.findByRole("option", { name: /Groceries/ }));
    await userEvent.click(dialog.getByRole("button", { name: "Save" }));
    await vi.waitFor(() => expect(setCategory).toHaveBeenCalledWith(["tx-3"], "cat-1"));
    expect(setTransferSide).toHaveBeenCalledWith("tx-3", { kind: "none" });
    expect(setTransferSide.mock.invocationCallOrder[0]).toBeLessThan(setCategory.mock.invocationCallOrder[0]);
    expect(notify).toHaveBeenCalledWith("1 transaction updated");
    expect(notify).not.toHaveBeenCalledWith("It is not a transfer any more");
  });

  it("offers no income for money out, and says why", async () => {
    renderOne(SPENDING);
    await userEvent.click(within(screen.getByRole("table")).getByText("Netflix"));
    const dialog = within(screen.getByRole("dialog"));
    expect(dialog.getByRole("button", { name: "Income" })).toBeDisabled();
    expect(dialog.getByText(/Money out is an expense or a transfer/)).toBeInTheDocument();
  });

  it("makes a spending a giroconto with an account outside Ledgerly", async () => {
    setTransferSide.mockResolvedValue({ ok: true });
    renderOne(SPENDING);
    await userEvent.click(within(screen.getByRole("table")).getByText("Netflix"));
    const dialog = within(screen.getByRole("dialog"));
    await userEvent.click(dialog.getByRole("button", { name: "Transfer" }));
    expect(dialog.getByRole("button", { name: "Save" })).toBeDisabled();
    await userEvent.selectOptions(dialog.getByLabelText(/Other account/), "outside");
    await userEvent.click(dialog.getByRole("button", { name: "Save" }));
    await vi.waitFor(() => expect(setTransferSide).toHaveBeenCalledWith("tx-1", { kind: "outside" }));
    expect(setCategory).not.toHaveBeenCalled();
  });
});
