import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import messages from "../../../../../../messages/en.json";
import { newDraft } from "./present";
import { RuleDialog } from "./rule-dialog";

const update = vi.fn();
vi.mock("../actions", () => ({
  createRuleAction: vi.fn(),
  updateRuleAction: (...args: unknown[]) => update(...args),
  setRuleStateAction: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

const T = messages.interests.form;
const ACCOUNTS = [
  { id: "a-source", name: "Conto della sorgente", publishable: true },
  { id: "a-manual", name: "Conto a mano", publishable: false },
];

function renderDialog(accountId: string, publish: boolean) {
  const draft = { ...newDraft(ACCOUNTS, "2026-11-18"), id: "r1", accountId, publish };
  render(
    <NextIntlClientProvider locale="en" messages={messages} timeZone="Europe/Rome">
      <RuleDialog draft={draft} accounts={ACCOUNTS} categories={[]} onClose={() => {}} />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  update.mockResolvedValue({ ok: true });
});

// plugin-settings.md §2.2: "Publish to {source}" is drawn only where the source can take it.
describe("RuleDialog, publishing", () => {
  it("offers the option on an account whose source is connected and writes", () => {
    renderDialog("a-source", false);
    expect(screen.getByRole("checkbox", { name: T.publish })).toBeInTheDocument();
  });

  it("does not draw the option on another account, and follows the account chosen", async () => {
    renderDialog("a-manual", false);
    expect(screen.queryByRole("checkbox", { name: T.publish })).not.toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText(T.account), "a-source");
    expect(screen.getByRole("checkbox", { name: T.publish })).toBeInTheDocument();
  });

  it("keeps the choice of a rule that publishes when the option is not drawn", async () => {
    renderDialog("a-manual", true);
    await userEvent.click(screen.getByRole("button", { name: T.save }));
    expect(update).toHaveBeenCalledWith("r1", expect.objectContaining({ publish: true }));
  });
});
