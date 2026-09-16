import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import messages from "../../../../../messages/en.json";
import type { IntegrationActionResult } from "./actions";
import { WalletCard, type WalletCardProps, type WalletCardState } from "./wallet-card";

const connect = vi.fn();
const test_ = vi.fn();
const sync = vi.fn();
const disconnect = vi.fn();

vi.mock("./actions", () => ({
  connectWalletAction: (...args: unknown[]) => connect(...args),
  testWalletAction: (...args: unknown[]) => test_(...args),
  syncWalletNowAction: (...args: unknown[]) => sync(...args),
  disconnectWalletAction: (...args: unknown[]) => disconnect(...args),
}));

const T = messages.settings.integrations;
const TOKEN = "wallet-secret-token-9f3a";

/**
 * The compile-time half of "the token never comes back": neither the card's props nor a Server
 * Action's result has a field a credential could sit in. Distributed over the union, so adding one
 * to a single branch is caught too. If either type grows a `token`, this file stops type-checking.
 */
type SecretKeys<T> = T extends unknown
  ? Extract<keyof T, "token" | "credentials" | "secret" | "password">
  : never;
type CarriesNoSecret<T> = [SecretKeys<T>] extends [never] ? true : false;

const PROPS_CARRY_NO_SECRET: CarriesNoSecret<WalletCardProps> = true;
const RESULT_CARRIES_NO_SECRET: CarriesNoSecret<IntegrationActionResult> = true;

function renderCard(state: WalletCardState = "active", lastSync: string | null = "3 Feb 2026, 09:07") {
  render(
    <NextIntlClientProvider locale="en" messages={messages} timeZone="Europe/Rome">
      <WalletCard state={state} lastSync={lastSync} />
    </NextIntlClientProvider>,
  );
}

/** Opens the token dialog and returns its field. */
async function openTokenField(): Promise<HTMLInputElement> {
  await userEvent.click(screen.getByRole("button", { name: T.actions.configure }));
  return screen.getByLabelText(T.connect.token) as HTMLInputElement;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("WalletCard", () => {
  it("offers only the token dialog while nothing is connected", () => {
    renderCard("absent", null);
    expect(screen.getByText(T.states.absent)).toBeInTheDocument();
    expect(screen.getByText(T.fields.never)).toBeInTheDocument();
    expect(screen.getByText(T.firstSync)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: T.actions.configure })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: T.actions.sync })).not.toBeInTheDocument();
  });

  it("shows the state, the last sync and the schedule of a live link", () => {
    renderCard();
    expect(screen.getByText(T.providers.wallet.name)).toBeInTheDocument();
    expect(screen.getByText(T.states.active)).toBeInTheDocument();
    expect(screen.getByText("3 Feb 2026, 09:07")).toBeInTheDocument();
    expect(screen.getByText(T.schedule)).toBeInTheDocument();
    expect(screen.queryByText(T.firstSync)).not.toBeInTheDocument();
  });

  it("says a rejected token is rejected, not that the link is fine", () => {
    renderCard("revoked");
    expect(screen.getByText(T.states.revoked)).toBeInTheDocument();
  });

  it("sends the pasted token to the action and keeps it out of the markup", async () => {
    // The action answers with a token it was never meant to return: the card must not show it.
    connect.mockResolvedValueOnce({ ok: true, token: TOKEN });
    renderCard("absent", null);
    const field = await openTokenField();
    expect(field).toHaveValue("");
    expect(field.type).toBe("password");
    expect(field).not.toHaveAttribute("value");

    await userEvent.type(field, TOKEN);
    await userEvent.click(screen.getByRole("button", { name: T.connect.submit }));

    expect(connect).toHaveBeenCalledWith(TOKEN);
    expect(await screen.findByRole("button", { name: T.actions.configure })).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain(TOKEN);
    expect(document.body.innerHTML).not.toContain(TOKEN);
  });

  it("reopens the dialog on an empty field, so it can only ever replace the token", async () => {
    connect.mockResolvedValueOnce({ ok: true });
    renderCard();
    const field = await openTokenField();
    await userEvent.type(field, TOKEN);
    await userEvent.click(screen.getByRole("button", { name: T.connect.replace }));
    expect(connect).toHaveBeenCalledWith(TOKEN);

    const again = await openTokenField();
    expect(again).toHaveValue("");
    expect(document.body.innerHTML).not.toContain(TOKEN);
  });

  it("proves the connection from the row's menu", async () => {
    test_.mockResolvedValueOnce({ ok: true });
    renderCard();
    await userEvent.click(screen.getByRole("button", { name: T.providers.wallet.name }));
    await userEvent.click(await screen.findByRole("menuitem", { name: T.actions.test }));
    expect(test_).toHaveBeenCalledTimes(1);
  });

  it("tells a refused token apart from a provider that is down", async () => {
    test_.mockResolvedValueOnce({ ok: false, error: "rejected" });
    renderCard();
    await userEvent.click(screen.getByRole("button", { name: T.providers.wallet.name }));
    await userEvent.click(await screen.findByRole("menuitem", { name: T.actions.test }));
    expect(await screen.findByRole("alert")).toHaveTextContent(T.errors.rejected);

    test_.mockResolvedValueOnce({ ok: false, error: "unreachable" });
    await userEvent.click(screen.getByRole("button", { name: T.providers.wallet.name }));
    await userEvent.click(await screen.findByRole("menuitem", { name: T.actions.test }));
    expect(await screen.findByRole("alert")).toHaveTextContent(T.errors.unreachable);
  });

  it("syncs the user's own link on demand", async () => {
    sync.mockResolvedValueOnce({ ok: true });
    renderCard();
    await userEvent.click(screen.getByRole("button", { name: T.actions.sync }));
    expect(sync).toHaveBeenCalledTimes(1);
  });

  it("reports a link that has gone from underneath the page", async () => {
    sync.mockResolvedValueOnce({ ok: false, error: "notConnected" });
    renderCard();
    await userEvent.click(screen.getByRole("button", { name: T.actions.sync }));
    expect(await screen.findByRole("alert")).toHaveTextContent(T.errors.notConnected);
  });

  it("asks before disconnecting, and keeps the link when the question is dismissed", async () => {
    renderCard();
    await userEvent.click(screen.getByRole("button", { name: T.providers.wallet.name }));
    await userEvent.click(await screen.findByRole("menuitem", { name: T.actions.disconnect }));

    const dialog = screen.getByRole("dialog", { name: T.disconnect.title });
    expect(dialog).toHaveTextContent(T.disconnect.description);
    await userEvent.click(screen.getByRole("button", { name: T.disconnect.cancel }));
    expect(disconnect).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("disconnects once the question is answered", async () => {
    disconnect.mockResolvedValueOnce({ ok: true });
    renderCard();
    await userEvent.click(screen.getByRole("button", { name: T.providers.wallet.name }));
    await userEvent.click(await screen.findByRole("menuitem", { name: T.actions.disconnect }));
    await userEvent.click(screen.getByRole("button", { name: T.disconnect.confirm }));
    expect(disconnect).toHaveBeenCalledTimes(1);
  });

  it("shows a catalogued error instead of crashing when an action rejects", async () => {
    connect.mockRejectedValueOnce(new Error("network down"));
    renderCard();
    const field = await openTokenField();
    await userEvent.type(field, TOKEN);
    await userEvent.click(screen.getByRole("button", { name: T.connect.replace }));
    expect(await screen.findByRole("alert")).toHaveTextContent(T.errors.failed);
  });

  it("has no type that a credential could travel in", () => {
    expect(PROPS_CARRY_NO_SECRET).toBe(true);
    expect(RESULT_CARRIES_NO_SECRET).toBe(true);
  });
});
