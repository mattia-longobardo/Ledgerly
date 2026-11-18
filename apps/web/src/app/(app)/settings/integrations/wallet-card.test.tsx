import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import messages from "../../../../../../../messages/en.json";
import type { IntegrationActionResult } from "./actions";
import type { ConnectionRowProps } from "./connection-row";
import { WalletAccounts, WalletCard, type WalletCardProps } from "./wallet-card";

const connect = vi.fn();
const disconnect = vi.fn();
const listChoice = vi.fn();
const saveChoice = vi.fn();
const rowAction = vi.fn();

vi.mock("./actions", () => ({
  connectWalletAction: (...args: unknown[]) => connect(...args),
  disconnectWalletAction: (...args: unknown[]) => disconnect(...args),
  walletAccountsAction: (...args: unknown[]) => listChoice(...args),
  chooseWalletAccountsAction: (...args: unknown[]) => saveChoice(...args),
}));
vi.mock("./connection-actions", () => ({
  runConnectionAction: (...args: unknown[]) => rowAction(...args),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

const T = messages.settings.integrations;
const P = messages.settings.plugin;
const C = messages.settings.connections;
const TOKEN = "wallet-secret-token-9f3a";
const NAME = T.providers.wallet.name;

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
const ROW_CARRIES_NO_SECRET: CarriesNoSecret<ConnectionRowProps> = true;
const RESULT_CARRIES_NO_SECRET: CarriesNoSecret<IntegrationActionResult> = true;

/** The row as the page builds it for a link that works, and for no link at all. */
const LIVE: ConnectionRowProps = {
  id: "c1",
  name: NAME,
  detail: T.providers.wallet.role,
  status: {
    value: "ok",
    text: "Updated 2 hours ago",
    at: "2026-02-03T08:07:00.000Z",
    title: null,
    action: null,
  },
  notice: null,
  history: [],
  historyMore: null,
  menu: [
    { kind: "update", label: C.actions.update },
    { kind: "replaceKey", label: C.actions.replaceKey },
    { kind: "test", label: C.actions.test },
    { kind: "advanced", label: C.actions.advanced, href: "/settings/integrations/advanced?c=c1" },
    { kind: "disconnect", label: C.actions.disconnect, danger: true },
  ],
};
const ABSENT: ConnectionRowProps = {
  id: "wallet",
  name: NAME,
  detail: T.providers.wallet.role,
  status: {
    value: "absent",
    text: "",
    at: null,
    title: null,
    action: { kind: "connect", label: C.actions.connect },
  },
  notice: null,
  history: null,
  historyMore: null,
  menu: [],
};

function renderCard(connected = true) {
  render(
    <NextIntlClientProvider locale="en" messages={messages} timeZone="Europe/Rome">
      <WalletCard
        row={connected ? LIVE : ABSENT}
        connected={connected}
        leave={{ accounts: 2, excluded: 1 }}
        deactivateHref="/settings/integrations/wallet#deactivate"
      />
    </NextIntlClientProvider>,
  );
}

async function fromMenu(label: string) {
  await userEvent.click(screen.getByRole("button", { name: NAME }));
  await userEvent.click(await screen.findByRole("menuitem", { name: label }));
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("WalletCard", () => {
  it("offers only the token dialog while nothing is connected", () => {
    renderCard(false);
    expect(screen.getByText(C.status.absent)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: C.actions.connect })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: C.actions.update })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: C.history.toggle })).not.toBeInTheDocument();
  });

  it("shows the state and the last update of a live link", () => {
    renderCard();
    expect(screen.getByText(NAME)).toBeInTheDocument();
    expect(screen.getByText(C.status.ok)).toBeInTheDocument();
    expect(screen.getByText("Updated 2 hours ago")).toBeInTheDocument();
  });

  it("sends the pasted token to the action and keeps it out of the markup", async () => {
    // The action answers with a token it was never meant to return: the card must not show it.
    connect.mockResolvedValueOnce({ ok: true, token: TOKEN });
    renderCard(false);
    await userEvent.click(screen.getByRole("button", { name: C.actions.connect }));
    const field = screen.getByLabelText(T.connect.token) as HTMLInputElement;
    expect(field).toHaveValue("");
    expect(field.type).toBe("password");
    expect(field).not.toHaveAttribute("value");

    await userEvent.type(field, TOKEN);
    await userEvent.click(screen.getByRole("button", { name: T.connect.submit }));

    expect(connect).toHaveBeenCalledWith(TOKEN);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain(TOKEN);
    expect(document.body.innerHTML).not.toContain(TOKEN);
  });

  it("reopens the dialog on an empty field, so it can only ever replace the token", async () => {
    connect.mockResolvedValueOnce({ ok: true });
    renderCard();
    await fromMenu(C.actions.replaceKey);
    const field = screen.getByLabelText(T.connect.token) as HTMLInputElement;
    await userEvent.type(field, TOKEN);
    await userEvent.click(screen.getByRole("button", { name: T.connect.replace }));
    expect(connect).toHaveBeenCalledWith(TOKEN);

    await fromMenu(C.actions.replaceKey);
    expect(screen.getByLabelText(T.connect.token)).toHaveValue("");
    expect(document.body.innerHTML).not.toContain(TOKEN);
  });

  it("leaves the update and the test of the link to the row's one action", async () => {
    rowAction.mockResolvedValue({ ok: true, toast: null });
    renderCard();
    await fromMenu(C.actions.test);
    expect(rowAction).toHaveBeenLastCalledWith("c1", "test");
    await fromMenu(C.actions.update);
    expect(rowAction).toHaveBeenLastCalledWith("c1", "update");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("asks before disconnecting, and keeps the link when the question is dismissed", async () => {
    renderCard();
    await fromMenu(C.actions.disconnect);

    // What stays and what stops (H55, point 4): the accounts, the ones left out, the settings.
    const dialog = screen.getByRole("dialog", { name: `Disconnect ${NAME}?` });
    expect(dialog).toHaveTextContent(`Access to ${NAME} is closed. The 2 accounts stay in Ledgerly`);
    expect(dialog).toHaveTextContent("The account choice and the schedule stay");
    expect(dialog).toHaveTextContent("1 excluded account stays excluded.");
    // The way to stop for good is on the source's page (plugin-settings.md §4.2).
    expect(screen.getByRole("link", { name: `Want to stop using ${NAME}? Turn it off` })).toHaveAttribute(
      "href",
      "/settings/integrations/wallet#deactivate",
    );
    await userEvent.click(screen.getByRole("button", { name: T.disconnect.cancel }));
    expect(disconnect).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("disconnects once the question is answered", async () => {
    disconnect.mockResolvedValueOnce({ ok: true });
    renderCard();
    await fromMenu(C.actions.disconnect);
    await userEvent.click(screen.getByRole("button", { name: T.disconnect.confirm }));
    expect(disconnect).toHaveBeenCalledTimes(1);
  });

  it("shows a catalogued error instead of crashing when an action rejects", async () => {
    connect.mockRejectedValueOnce(new Error("network down"));
    renderCard();
    await fromMenu(C.actions.replaceKey);
    await userEvent.type(screen.getByLabelText(T.connect.token), TOKEN);
    await userEvent.click(screen.getByRole("button", { name: T.connect.replace }));
    expect(await screen.findByRole("alert")).toHaveTextContent(T.errors.failed);
  });

  it("has no type that a credential could travel in", () => {
    expect(PROPS_CARRY_NO_SECRET).toBe(true);
    expect(ROW_CARRIES_NO_SECRET).toBe(true);
    expect(RESULT_CARRIES_NO_SECRET).toBe(true);
  });

  it("keeps the choice of the accounts out of the row's menu: it is a section of the page", async () => {
    renderCard();
    await userEvent.click(screen.getByRole("button", { name: NAME }));
    expect(screen.queryByRole("menuitem", { name: C.actions.chooseAccounts })).not.toBeInTheDocument();
  });
});

describe("WalletAccounts", () => {
  // PERS-419: which Wallet accounts arrive here, as for a bank; on the source's page from N7.2.
  it("chooses the accounts: one here stays chosen, one left out can be chosen again", async () => {
    listChoice.mockResolvedValueOnce({
      ok: true,
      accounts: [
        { externalId: "wa-1", name: "Conto", here: "Conto corrente", chosen: true },
        { externalId: "wa-2", name: "Viaggi", here: null, chosen: false },
        { externalId: "wa-3", name: "Contanti", here: null, chosen: true },
      ],
    });
    saveChoice.mockResolvedValueOnce({ ok: true });
    render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="Europe/Rome">
        <WalletAccounts />
      </NextIntlClientProvider>,
    );
    // The list is read only when asked for: the page never calls the source by itself.
    expect(listChoice).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: P.accounts.choose }));
    const here = await screen.findByRole("checkbox", { name: "Conto" });
    expect(here).toBeChecked();
    expect(here).toBeDisabled();
    expect(screen.getByText(T.choose.here.replace("{account}", "Conto corrente"))).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Viaggi" })).not.toBeChecked();

    await userEvent.click(screen.getByRole("checkbox", { name: "Viaggi" }));
    await userEvent.click(screen.getByRole("checkbox", { name: "Contanti" }));
    await userEvent.click(screen.getByRole("button", { name: T.choose.save }));
    expect(saveChoice).toHaveBeenCalledWith(["wa-1", "wa-2"]);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
