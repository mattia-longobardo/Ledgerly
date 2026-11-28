import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import messages from "../../../../../../messages/en.json";
import { newDraft } from "./present";
import { RuleDialog } from "./rule-dialog";

const update = vi.fn();
vi.mock("../calls", () => ({
  createRuleAction: vi.fn(),
  updateRuleAction: (...args: unknown[]) => update(...args),
  setRuleStateAction: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

const T = messages.interests.form;
const ACCOUNTS = [{ id: "a-one", name: "Conto uno" }];

function renderDialog(retiredMode: boolean) {
  const draft = { ...newDraft(ACCOUNTS, "2026-11-18", "26"), id: "r1", retiredMode };
  render(
    <NextIntlClientProvider locale="en" messages={messages} timeZone="Europe/Rome">
      <RuleDialog draft={draft} accounts={ACCOUNTS} onClose={() => {}} />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  update.mockResolvedValue({ ok: true });
});

// Decision H37: no rule publishes on its source; the dialog no longer offers it.
describe("RuleDialog, the retired «Publish to {source}»", () => {
  it("draws no option to publish and no category of the source", () => {
    renderDialog(false);
    // «Credit the interest to the account» and «Rule is active»: no box to publish.
    expect(screen.getAllByRole("checkbox")).toHaveLength(2);
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
  });

  it("tells a rule that still has the mode that it is gone, and saves it as analysis only", async () => {
    renderDialog(true);
    expect(screen.getByRole("note")).toHaveTextContent(T.retiredMode);
    await userEvent.click(screen.getByRole("button", { name: T.save }));
    expect(update).toHaveBeenCalledWith("r1", expect.not.objectContaining({ publish: expect.anything() }));
  });

  it("shows the route's refusal of the mode in words", async () => {
    update.mockResolvedValue({ ok: false, error: "mode_retired" });
    renderDialog(false);
    await userEvent.click(screen.getByRole("button", { name: T.save }));
    expect(await screen.findByRole("alert")).toHaveTextContent(messages.interests.errors.mode_retired);
  });
});

describe("RuleDialog, the credit to the account", () => {
  it("sends the credit ticked, and leaves it off by default", async () => {
    renderDialog(false);
    await userEvent.click(screen.getByRole("button", { name: T.save }));
    expect(update).toHaveBeenLastCalledWith("r1", expect.objectContaining({ credit: false }));
    await userEvent.click(screen.getByRole("checkbox", { name: T.credit }));
    await userEvent.click(screen.getByRole("button", { name: T.save }));
    expect(update).toHaveBeenLastCalledWith("r1", expect.objectContaining({ credit: true }));
  });

  it("shows the refusal of a credit on an account that is not manual in words", async () => {
    update.mockResolvedValue({ ok: false, error: "not_manual" });
    renderDialog(false);
    await userEvent.click(screen.getByRole("button", { name: T.save }));
    expect(await screen.findByRole("alert")).toHaveTextContent(messages.interests.errors.not_manual);
  });
});

// R5g (E6): the conventions of the rule are fields of the dialog.
describe("RuleDialog, the conventions of the rule", () => {
  it("sends the day count and the payment window typed under Advanced", async () => {
    renderDialog(false);
    await userEvent.selectOptions(screen.getByLabelText(T.basis), "act_act");
    await userEvent.type(screen.getByLabelText(T.paymentWindow, { exact: false }), "5");
    await userEvent.click(screen.getByRole("button", { name: T.save }));
    expect(update).toHaveBeenCalledWith(
      "r1",
      expect.objectContaining({ dayCount: "act_act", paymentWindowDays: "5" }),
    );
  });

  it("keeps the default window when the field is left empty", async () => {
    renderDialog(false);
    await userEvent.click(screen.getByRole("button", { name: T.save }));
    expect(update).toHaveBeenCalledWith(
      "r1",
      expect.objectContaining({ dayCount: "365", paymentWindowDays: "" }),
    );
  });
});
