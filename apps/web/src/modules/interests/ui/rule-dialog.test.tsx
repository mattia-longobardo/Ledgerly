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
    expect(screen.getAllByRole("checkbox")).toHaveLength(1);
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
