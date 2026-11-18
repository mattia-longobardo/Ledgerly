import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { type ReactNode, useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import messages from "../../../../../../messages/en.json";
import { CategoryActions, type CategoryCommands } from "./category-actions";
import { CategoryCell } from "./category-cell";
import { DefaultGroupsForm } from "./default-groups-form";
import { type ReviewGroupView, ReviewList } from "./review-list";
import { TransactionsTable } from "./transactions-table";
import type { CategoryOption, RowView } from "./view";

const refresh = vi.fn();
const notify = vi.fn();
const setCategory = vi.fn();

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh }) }));
vi.mock("@/ui/toast", () => ({ notify: (...args: unknown[]) => notify(...args) }));
vi.mock("./commands", () => ({
  setCategory: (...args: unknown[]) => setCategory(...args),
  hide: vi.fn(),
  restore: vi.fn(),
  removeHidden: vi.fn(),
  setNote: vi.fn(),
  setLabels: vi.fn(),
}));

const CATEGORIES: CategoryOption[] = [
  { id: "cat-1", name: "Groceries", color: "#2563eb" },
  { id: "cat-2", name: "Restaurants", color: "#047857" },
];

function commandsWith(overrides: Partial<CategoryCommands> = {}): CategoryCommands {
  return {
    confirm: vi.fn(async (ids: string[]) => ({ ok: true as const, count: ids.length, undoId: "undo-1" })),
    choose: vi.fn(async (ids: string[]) => ({ ok: true as const, count: ids.length, undoId: "undo-2" })),
    undo: vi.fn(async () => ({ ok: true as const, count: 1 })),
    similar: vi.fn(async () => ({ text: "", rows: [] })),
    ...overrides,
  };
}

const wrap = (children: ReactNode) => (
  <NextIntlClientProvider locale="en" messages={messages} timeZone="Europe/Rome">
    {children}
  </NextIntlClientProvider>
);

const base: RowView = {
  id: "tx-1",
  date: "12 Nov 2026",
  payee: "MERCATO ALFA",
  account: "Zeta current",
  categoryId: "cat-1",
  categoryName: "Groceries",
  categoryColor: "#2563eb",
  amount: "−54,20 €",
  amountTone: "neg",
  badges: [],
  hidden: false,
  note: null,
  labels: [],
  labelIds: [],
};
const automatic: RowView = {
  ...base,
  categoryState: "automatic",
  categoryReason: { code: "memory", params: { text: "MERCATO ALFA" } },
};
const suggested: RowView = {
  ...base,
  id: "tx-2",
  categoryId: null,
  categoryName: null,
  categoryColor: null,
  categoryState: "suggestion",
  categoryReason: { code: "similar", params: {} },
  suggestion: { id: "cat-2", name: "Restaurants", color: "#047857" },
};
const none: RowView = {
  ...base,
  id: "tx-3",
  categoryId: null,
  categoryName: null,
  categoryColor: null,
  categoryState: "none",
};

/** The cell with the picker's state held as the table holds it. */
function Cell({ row, onConfirm }: { row: RowView; onConfirm?: () => Promise<boolean> }) {
  const [open, setOpen] = useState(false);
  return (
    <CategoryCell
      row={row}
      categories={CATEGORIES}
      open={open}
      onOpenChange={setOpen}
      onPick={vi.fn()}
      onConfirm={onConfirm}
    />
  );
}

beforeEach(() => vi.clearAllMocks());

describe("the category of a movement in its states", () => {
  it("draws an automatic category with a mark that says why, and confirms from there", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn(async () => true);
    render(wrap(<Cell row={automatic} onConfirm={onConfirm} />));

    expect(screen.getByRole("button", { name: "Edit category" })).toHaveTextContent("Groceries");
    await user.click(screen.getByRole("button", { name: "Automatic category: show the reason" }));
    const popup = within(await screen.findByRole("dialog", { name: "Automatic category" }));
    expect(
      popup.getByText("The last 3 times you chose this category for “MERCATO ALFA”."),
    ).toBeInTheDocument();
    // No number of the model is ever on screen.
    expect(popup.queryByText(/%|confidence|model|threshold/i)).not.toBeInTheDocument();

    await user.click(popup.getByRole("button", { name: "Confirm" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("draws a suggestion as a dashed chip that starts with the word, and says it does not count yet", async () => {
    const user = userEvent.setup();
    render(wrap(<Cell row={suggested} onConfirm={vi.fn(async () => true)} />));

    const chip = screen.getByRole("button", { name: "Suggestion: Restaurants. Not confirmed" });
    expect(chip).toHaveTextContent("Suggestion: Restaurants");
    await user.click(chip);
    const popup = within(await screen.findByRole("dialog", { name: "Suggestion" }));
    expect(
      popup.getByText(/It is similar to other transactions you put in this category\./),
    ).toBeInTheDocument();
    expect(popup.getByText(/It does not count in this category until you confirm\./)).toBeInTheDocument();
    // "Confirm" has the focus: E, then Enter, confirms from the keyboard.
    expect(popup.getByRole("button", { name: "Confirm" })).toHaveFocus();
  });

  it("hands over to the picker for another category than the one suggested", async () => {
    const user = userEvent.setup();
    render(wrap(<Cell row={suggested} onConfirm={vi.fn(async () => true)} />));
    await user.click(screen.getByRole("button", { name: /Suggestion: Restaurants/ }));
    await user.click(await screen.findByRole("button", { name: "Choose another" }));
    expect(await screen.findByRole("option", { name: "Groceries" })).toBeInTheDocument();
  });

  it("reads the fallback for a reason it has no sentence for", async () => {
    const user = userEvent.setup();
    const row = { ...automatic, categoryReason: { code: "from_the_future", params: {} } };
    render(wrap(<Cell row={row} onConfirm={vi.fn(async () => true)} />));
    await user.click(screen.getByRole("button", { name: "Automatic category: show the reason" }));
    expect(
      await screen.findByText("Ledgerly chose this category from the transaction data."),
    ).toBeInTheDocument();
  });

  it("draws a movement with no category as To categorise, and a chosen one with no mark", () => {
    render(wrap(<Cell row={none} onConfirm={vi.fn(async () => true)} />));
    expect(screen.getByRole("button", { name: "Edit category" })).toHaveTextContent("To categorise");
    expect(screen.queryByTestId("auto-mark")).not.toBeInTheDocument();
  });

  it("is the plain chip of before where the page set no automatic categories up", () => {
    render(wrap(<Cell row={automatic} />));
    expect(screen.queryByTestId("auto-mark")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit category" })).toHaveTextContent("Groceries");
  });
});

describe("the table with the automatic categories", () => {
  function renderTable(commands: CategoryCommands) {
    render(
      wrap(
        <CategoryActions commands={commands} categories={CATEGORIES}>
          <TransactionsTable
            groups={[{ key: "all", label: null, count: 3, total: "", rows: [automatic, suggested, none] }]}
            categories={CATEGORIES}
            labels={[]}
            params={{}}
            sort="date"
            direction="desc"
          />
        </CategoryActions>,
      ),
    );
    return within(screen.getByRole("table"));
  }

  it("confirms the suggestions of the selection, and only those", async () => {
    const user = userEvent.setup();
    const commands = commandsWith();
    const table = renderTable(commands);
    await user.click(table.getByRole("checkbox", { name: "Select all" }));

    await user.click(screen.getByRole("button", { name: "Confirm suggestions (1)" }));

    await waitFor(() => expect(commands.confirm).toHaveBeenCalledWith(["tx-2"]));
    await waitFor(() => expect(notify).toHaveBeenCalledWith("Category confirmed"));
  });

  it("asks whether the similar movements follow after a choice on one movement, and applies with Undo", async () => {
    const user = userEvent.setup();
    setCategory.mockResolvedValue({ ok: true, count: 1 });
    const commands = commandsWith({
      similar: vi.fn(async () => ({
        text: "MERCATO ALFA",
        rows: [
          {
            id: "tx-8",
            date: "5 Nov 2026",
            amount: "−38,90 €",
            categoryId: "cat-2",
            suggestedCategoryId: null,
            automatic: true,
          },
          {
            id: "tx-9",
            date: "29 Oct 2026",
            amount: "−71,15 €",
            categoryId: null,
            suggestedCategoryId: null,
            automatic: false,
          },
        ],
      })),
    });
    const table = renderTable(commands);
    await user.click(table.getAllByRole("button", { name: "Edit category" })[1]);
    await user.click(await screen.findByRole("option", { name: "Groceries" }));

    const dialog = within(await screen.findByRole("dialog", { name: "Apply to 2 similar transactions?" }));
    expect(commands.similar).toHaveBeenCalledWith("tx-3", "cat-1");
    expect(dialog.getByText(/You put “MERCATO ALFA” in Groceries\./)).toBeInTheDocument();
    expect(dialog.getByText("To categorise")).toBeInTheDocument();

    await user.click(dialog.getByRole("button", { name: "Apply to 2" }));
    await waitFor(() => expect(commands.choose).toHaveBeenCalledWith(["tx-8", "tx-9"], "cat-1"));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    const [message, , action] = notify.mock.calls.at(-1)!;
    expect(message).toBe("2 transactions updated");
    action.onClick();
    expect(commands.undo).toHaveBeenCalledWith("undo-2");
  });

  it("asks nothing when no similar movement is left, and nothing after a choice on several rows", async () => {
    const user = userEvent.setup();
    setCategory.mockResolvedValue({ ok: true, count: 2 });
    const commands = commandsWith();
    const table = renderTable(commands);
    await user.click(table.getByRole("checkbox", { name: "Select all" }));
    await user.click(screen.getByRole("button", { name: "Set category" }));
    await user.click(await screen.findByRole("option", { name: "Groceries" }));
    await waitFor(() => expect(setCategory).toHaveBeenCalled());
    expect(commands.similar).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("keeps the first choice and says so when the similar ones cannot be saved", async () => {
    const user = userEvent.setup();
    setCategory.mockResolvedValue({ ok: true, count: 1 });
    const commands = commandsWith({
      similar: vi.fn(async () => ({
        text: "MERCATO ALFA",
        rows: [
          {
            id: "tx-8",
            date: "5 Nov 2026",
            amount: "−38,90 €",
            categoryId: null,
            suggestedCategoryId: null,
            automatic: false,
          },
        ],
      })),
      choose: vi.fn(async () => ({ ok: false as const, error: "invalid" })),
    });
    const table = renderTable(commands);
    await user.click(table.getAllByRole("button", { name: "Edit category" })[1]);
    await user.click(await screen.findByRole("option", { name: "Groceries" }));
    const dialog = within(await screen.findByRole("dialog"));
    await user.click(dialog.getByRole("button", { name: "Apply to 1" }));
    expect(await dialog.findByRole("alert")).toHaveTextContent(
      "Couldn't apply the category. The first transaction is saved. Try again.",
    );
  });
});

const rows = (count: number) =>
  Array.from({ length: count }, (_, index) => ({
    id: `row-${index}`,
    date: `${index + 1} Nov 2026`,
    account: "Zeta current",
    amount: "−10,00 €",
  }));
const GROUP: ReviewGroupView = {
  id: "mercato alfa|cat-1",
  text: "MERCATO ALFA",
  count: 5,
  total: "−50,00 €",
  suggestion: { id: "cat-1", name: "Groceries", color: "#2563eb" },
  reason: { code: "similar", params: {} },
  rows: rows(5),
};
const PLAIN: ReviewGroupView = {
  ...GROUP,
  id: "xyz|",
  text: "XYZ",
  suggestion: null,
  reason: null,
  count: 2,
  rows: rows(2),
};

function renderReview(commands: CategoryCommands, groups = { suggested: [GROUP], unsuggested: [PLAIN] }) {
  render(
    wrap(
      <CategoryActions commands={commands} categories={CATEGORIES}>
        <ReviewList {...groups} singlesCount={0} categories={CATEGORIES} singles={null} />
      </CategoryActions>,
    ),
  );
}

describe("the groups of To review", () => {
  it("confirms a group with one action and leaves a line with Undo in its place", async () => {
    const user = userEvent.setup();
    const commands = commandsWith();
    renderReview(commands);
    const card = within(screen.getAllByTestId("review-group")[0]);
    expect(card.getByRole("heading", { level: 3, name: "MERCATO ALFA" })).toBeInTheDocument();
    expect(card.getByText("5 transactions · −50,00 €")).toBeInTheDocument();

    await user.click(
      card.getByRole("button", { name: "Confirm “Groceries” for 5 transactions of MERCATO ALFA" }),
    );

    await waitFor(() => expect(commands.confirm).toHaveBeenCalledWith(rows(5).map((row) => row.id)));
    const done = await screen.findByTestId("review-done-row");
    expect(done).toHaveTextContent("MERCATO ALFA · 5 transactions in “Groceries”");
    expect(refresh).toHaveBeenCalled();
    expect(screen.getAllByTestId("review-group")).toHaveLength(1);

    await user.click(within(done).getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(commands.undo).toHaveBeenCalledWith("undo-1"));
    await waitFor(() => expect(screen.queryByTestId("review-done-row")).not.toBeInTheDocument());
  });

  it("leaves a row out of the action when the person unticks it, and the button says the number", async () => {
    const user = userEvent.setup();
    const commands = commandsWith();
    renderReview(commands);
    const card = within(screen.getAllByTestId("review-group")[0]);
    await user.click(card.getByRole("button", { name: "Show all 5" }));
    await user.click(card.getByRole("checkbox", { name: "Include the transaction of 2 Nov 2026" }));

    await user.click(card.getByRole("button", { name: /Confirm “Groceries” for 4 transactions/ }));

    await waitFor(() => expect(commands.confirm).toHaveBeenCalledTimes(1));
    expect(vi.mocked(commands.confirm).mock.calls[0][0]).toHaveLength(4);
    expect(vi.mocked(commands.confirm).mock.calls[0][0]).not.toContain("row-1");
  });

  it("offers one button to choose a category for a group with no suggestion", async () => {
    const user = userEvent.setup();
    const commands = commandsWith();
    renderReview(commands);
    const card = within(screen.getAllByTestId("review-group")[1]);
    expect(card.queryByTestId("review-group-confirm")).not.toBeInTheDocument();
    await user.click(card.getByRole("button", { name: "Choose a category for 2 transactions of XYZ" }));
    await user.click(await screen.findByRole("option", { name: "Restaurants" }));
    await waitFor(() => expect(commands.choose).toHaveBeenCalledWith(["row-0", "row-1"], "cat-2"));
    expect(await screen.findByTestId("review-done-row")).toHaveTextContent(
      "XYZ · 2 transactions in “Restaurants”",
    );
  });

  it("keeps the card and says so when the action fails: never some of the rows", async () => {
    const user = userEvent.setup();
    const commands = commandsWith({ confirm: vi.fn(async () => ({ ok: false as const, error: "invalid" })) });
    renderReview(commands);
    const card = within(screen.getAllByTestId("review-group")[0]);
    await user.click(card.getByTestId("review-group-confirm"));
    expect(await card.findByRole("alert")).toHaveTextContent("Couldn't save. Try again.");
    expect(screen.queryByTestId("review-done-row")).not.toBeInTheDocument();
  });

  it("says there are no suggestions yet, with no number of how it learns", () => {
    renderReview(commandsWith(), { suggested: [], unsuggested: [PLAIN] });
    expect(screen.getByText(/Ledgerly has no suggestions for these transactions yet\./)).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "With a suggestion" })).not.toBeInTheDocument();
  });
});

describe("the default groups", () => {
  const groups = [
    { key: "home", name: "Home", examples: "Rent, bills", color: "#111111" },
    { key: "groceries", name: "Groceries", examples: "Supermarket", color: "#222222" },
  ];

  it("creates the groups ticked, and the button says how many", async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn(async (keys: string[]) => keys.length);
    const onCreated = vi.fn();
    render(wrap(<DefaultGroupsForm groups={groups} onCreate={onCreate} onCreated={onCreated} />));
    expect(screen.getByRole("checkbox", { name: /Home/ })).toHaveAccessibleDescription("Rent, bills");

    await user.click(screen.getByRole("checkbox", { name: /Home/ }));
    await user.click(screen.getByRole("button", { name: "Create 1 group" }));

    await waitFor(() => expect(onCreate).toHaveBeenCalledWith(["groceries"]));
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(1));
  });

  it("creates nothing with nothing ticked, and says when it could not create", async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn(async () => null);
    render(wrap(<DefaultGroupsForm groups={groups} onCreate={onCreate} onCreated={vi.fn()} />));
    await user.click(screen.getByRole("button", { name: "Create 2 groups" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't create the groups. Try again.");
    await user.click(screen.getByRole("checkbox", { name: /Home/ }));
    await user.click(screen.getByRole("checkbox", { name: /Groceries/ }));
    expect(screen.getByRole("button", { name: /Create/ })).toBeDisabled();
  });
});
