import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";
import messages from "../../../../messages/en.json";
import { InactiveSubscriptions, type SubscriptionView } from "./subscriptions-table";

const notify = vi.fn();
vi.mock("@/ui/toast", () => ({ notify: (...a: unknown[]) => notify(...a) }));

const deleteSubscription = vi.fn();
vi.mock("../actions", () => ({
  deleteSubscriptionAction: (...a: unknown[]) => deleteSubscription(...a),
  setUtilityAction: vi.fn(),
  setSubscriptionStateAction: vi.fn(),
  updateSubscriptionAction: vi.fn(),
  createSubscriptionAction: vi.fn(),
}));

function view(name: string, state: "paused" | "cancelled"): SubscriptionView {
  return {
    draft: {
      id: `s-${name}`,
      state,
      name,
      categoryId: null,
      paymentAccountId: null,
      priceInput: "9,99",
      cycle: "monthly",
      nextChargeOn: "2026-10-15",
      payeeMatch: "",
      toleranceInput: "5,00",
      utility: 5,
      lastMatch: null,
    },
    name,
    categoryName: null,
    categoryColor: null,
    due: "Day 15",
    dueOn: "15 Oct 2026",
    utility: 5,
    price: "9,99 €",
    priceCents: 999n,
    cycle: "monthly",
    accountName: "Revolut",
    monthly: "9,99 €",
    monthlyCents: 999n,
    yearly: "119,88 €",
    yearlyCents: 11_988n,
    status: "not_due",
    statusDetail: "",
  };
}

const options = { accounts: [], categories: [], defaultTolerance: "5,00" } as never;

function renderSection(rows: SubscriptionView[], title: string, deletable = false) {
  render(
    <NextIntlClientProvider locale="en" messages={messages} timeZone="Europe/Rome">
      <InactiveSubscriptions rows={rows} options={options} title={title} deletable={deletable} />
    </NextIntlClientProvider>,
  );
}

describe("InactiveSubscriptions", () => {
  it("renders nothing at all when its own list is empty", () => {
    const { container } = render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="Europe/Rome">
        <InactiveSubscriptions rows={[]} options={options} title="0 paused" />
      </NextIntlClientProvider>,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("opens from its summary and shows a row per subscription", async () => {
    renderSection([view("Gym", "paused")], "1 paused");
    expect(screen.getByText("1 paused")).toBeInTheDocument();
    expect(screen.getByTestId("inactive-row")).toHaveTextContent("Gym");
    expect(screen.getByTestId("inactive-row")).toHaveTextContent("9,99 €");
  });

  it("offers no deletion on a paused one: cancelling is the step before deleting", () => {
    renderSection([view("Gym", "paused")], "1 paused");
    expect(screen.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
  });

  it("asks before deleting a cancelled one, and only then deletes", async () => {
    deleteSubscription.mockResolvedValueOnce({ ok: true });
    renderSection([view("Sky", "cancelled")], "1 cancelled", true);
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    const dialog = await screen.findByRole("dialog", { name: "Delete this subscription?" });
    expect(dialog).toHaveTextContent("Sky and the payments it had checked are removed for good.");
    expect(dialog).toHaveTextContent("The transactions themselves are untouched");
    expect(deleteSubscription).not.toHaveBeenCalled();

    await userEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
    expect(deleteSubscription).toHaveBeenCalledWith("s-Sky");
    expect(notify).toHaveBeenCalledWith("Sky deleted");
  });

  it("says why when the service refuses", async () => {
    deleteSubscription.mockResolvedValueOnce({ ok: false, error: "not_cancelled" });
    renderSection([view("Sky", "cancelled")], "1 cancelled", true);
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    const dialog = await screen.findByRole("dialog", { name: "Delete this subscription?" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
    expect(notify).toHaveBeenCalledWith(
      "It is not cancelled: cancel it first, then it can be deleted.",
      "error",
    );
  });
});
