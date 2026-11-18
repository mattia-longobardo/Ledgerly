import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import messages from "../../../../../../../messages/en.json";
import { DeleteAccount } from "./delete-account";

const list = vi.fn();
const move = vi.fn();
const remove = vi.fn();
const push = vi.fn();

vi.mock("./delete-actions", () => ({
  accountDependentsAction: (...args: unknown[]) => list(...args),
  moveDependentAction: (...args: unknown[]) => move(...args),
  deleteAccountAction: (...args: unknown[]) => remove(...args),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }));

const T = messages.accounts.settings.danger;
const ID = "00000000-0000-4000-8000-000000000001";
const NEXT = "00000000-0000-4000-8000-000000000002";
const TARGETS = [{ id: NEXT, name: "Revolut" }];

function renderButton(source: string | null = null) {
  render(
    <NextIntlClientProvider locale="en" messages={messages} timeZone="Europe/Rome">
      <DeleteAccount accountId={ID} name="Holidays" source={source} />
    </NextIntlClientProvider>,
  );
}

const confirm = () => screen.getByRole("button", { name: T.confirm });

/**
 * A control of the list once the reading is over: the rows can show while the transition that read
 * them is still pending, and a disabled `<select>` drops the choice (seen under load, nightly 18/11).
 */
async function usable<E extends HTMLElement>(found: Promise<E> | E): Promise<E> {
  const element = await found;
  await waitFor(() => expect(element).toBeEnabled());
  return element;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("DeleteAccount (PERS-419)", () => {
  it("deletes at once an account nothing rests on, and says so", async () => {
    list.mockResolvedValueOnce({ ok: true, dependents: [], targets: [] });
    remove.mockResolvedValueOnce({ ok: true });
    renderButton();
    await userEvent.click(screen.getByRole("button", { name: T.remove }));
    expect(await screen.findByText(T.confirmBody.replace("{name}", "Holidays"))).toBeInTheDocument();
    await userEvent.click(confirm());
    expect(remove).toHaveBeenCalledWith(ID);
    expect(push).toHaveBeenCalledWith("/accounts");
  });

  it("lists what rests on the account and offers the deletion only once each thing is moved", async () => {
    list
      .mockResolvedValueOnce({
        ok: true,
        dependents: [
          { kind: "pocket", id: "p1", label: "Trip" },
          { kind: "interestRule", id: "r1", label: "2026-01-01" },
          { kind: "budgetLimit", id: "", label: null },
        ],
        targets: TARGETS,
      })
      .mockResolvedValueOnce({
        ok: true,
        dependents: [
          { kind: "interestRule", id: "r1", label: "2026-01-01" },
          { kind: "budgetLimit", id: "", label: null },
        ],
        targets: TARGETS,
      });
    move.mockResolvedValueOnce({ ok: true });
    renderButton();
    await userEvent.click(screen.getByRole("button", { name: T.remove }));

    const pocket = T.dependents.pocket.replace("{name}", "Trip");
    const select = await usable(screen.findByLabelText(pocket));
    expect(screen.getByLabelText("Interest rule from 1 Jan 2026")).toBeInTheDocument();
    expect(screen.getByLabelText(T.dependents.budgetAccount)).toBeInTheDocument();
    expect(confirm()).toBeDisabled();

    // No target chosen: nothing is sent.
    const [first] = screen.getAllByRole("button", { name: T.dependents.move });
    await userEvent.click(first);
    expect(move).not.toHaveBeenCalled();
    expect(screen.getByText(T.errors.chooseTarget)).toBeInTheDocument();

    await userEvent.selectOptions(select, NEXT);
    await userEvent.click(first);
    expect(move).toHaveBeenCalledWith({ accountId: ID, kind: "pocket", id: "p1", to: NEXT });
    expect(await screen.findAllByRole("button", { name: T.dependents.move })).toHaveLength(2);
    expect(confirm()).toBeDisabled();
  });

  it("says why a move was refused, next to the thing", async () => {
    list.mockResolvedValueOnce({
      ok: true,
      dependents: [{ kind: "interestRule", id: "r1", label: "2026-01-01" }],
      targets: TARGETS,
    });
    move.mockResolvedValueOnce({ ok: false, error: "not_synced" });
    renderButton();
    await userEvent.click(screen.getByRole("button", { name: T.remove }));
    await userEvent.selectOptions(
      await usable(screen.findByLabelText("Interest rule from 1 Jan 2026")),
      NEXT,
    );
    await userEvent.click(screen.getByRole("button", { name: T.dependents.move }));
    expect(await screen.findByText(T.errors.notSynced)).toBeInTheDocument();
  });

  it("tells, for an account of a source, that it leaves the source's accounts and how it comes back", async () => {
    list.mockResolvedValueOnce({ ok: true, dependents: [], targets: [] });
    renderButton("Zeta Source");
    await userEvent.click(screen.getByRole("button", { name: T.remove }));
    expect(await screen.findByText(T.sourceNote.replaceAll("{source}", "Zeta Source"))).toBeInTheDocument();
  });
});
