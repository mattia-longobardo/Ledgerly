import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import messages from "../../../../../messages/en.json";
import { BankRow, type BankRowProps } from "./bank-row";

const sync = vi.fn();
const refresh = vi.fn();
const push = vi.fn();

vi.mock("./plugin-actions", () => ({ syncBankNowAction: (...args: unknown[]) => sync(...args) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh }) }));

const BANK: BankRowProps = {
  id: "c-1",
  name: "Zeta Bank",
  state: "active",
  errorCode: null,
  waiting: false,
  accounts: 2,
  lastSync: "15 Nov 2026, 08:02",
  nextSync: "15 Nov 2026, 13:10",
  validUntil: "13 May 2027",
};

function renderRow(bank: Partial<BankRowProps> = {}, disabled = false) {
  const onDisconnect = vi.fn();
  render(
    <NextIntlClientProvider locale="en" messages={messages} timeZone="Europe/Rome">
      <BankRow
        pluginId="enablebanking"
        bank={{ ...BANK, ...bank }}
        disabled={disabled}
        onDisconnect={onDisconnect}
      />
    </NextIntlClientProvider>,
  );
  return { onDisconnect };
}

beforeEach(() => {
  sync.mockReset();
  refresh.mockReset();
});

describe("the row of a bank", () => {
  it("says the state in a word, the accounts, the end of the access and the readings", () => {
    renderRow();
    for (const text of [
      "Connected",
      "2 accounts · access valid until 13 May 2027",
      "Last reading",
      "15 Nov 2026, 08:02",
      "Automatic readings",
      "3 times a day",
      "Next: 15 Nov 2026, 13:10",
    ]) {
      expect(screen.getByText(text)).toBeTruthy();
    }
  });

  it("syncs now and says how many movements are new", async () => {
    sync.mockResolvedValue({ ok: true, created: 3 });
    renderRow();
    await userEvent.click(screen.getByRole("button", { name: "Sync now" }));
    expect(sync).toHaveBeenCalledWith("enablebanking", "c-1");
    expect(refresh).toHaveBeenCalled();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it.each([
    [{ ok: false, error: "busy", retryAt: null }, "A reading is already running. Try again shortly."],
    [
      { ok: false, error: "rate_limited", retryAt: "15 Nov 2026, 16:00" },
      "The bank accepts no more readings for now. Try again after 15 Nov 2026, 16:00.",
    ],
    [
      { ok: false, error: "plugin_down", retryAt: null },
      "The connection to banks is not available now. Try again later or tell the administrator.",
    ],
    [{ ok: false, error: "something-new", retryAt: null }, "Something went wrong. Try again."],
  ])("says why a reading did not happen (%j), with a sentence and never a code", async (result, sentence) => {
    sync.mockResolvedValue(result);
    renderRow();
    await userEvent.click(screen.getByRole("button", { name: "Sync now" }));
    expect((await screen.findByRole("alert")).textContent).toBe(sentence);
  });

  it("shows the last failure of a bank in error, and still offers to sync", () => {
    renderRow({ state: "error", errorCode: "provider_down" });
    expect(screen.getByText("Error")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toBe(
      "The bank is not responding. Ledgerly tries again at the next automatic reading.",
    );
    expect(screen.getByRole("button", { name: "Sync now" })).toBeTruthy();
  });

  it("offers to choose the accounts while the connection is to complete", () => {
    renderRow({ state: "pending", lastSync: null });
    expect(screen.getByText("To complete")).toBeTruthy();
    expect(screen.getByText("You gave access, but you have not chosen the accounts yet.")).toBeTruthy();
    const link = screen.getByRole("link", { name: "Choose accounts" });
    expect(link.getAttribute("href")).toBe("/banks/connect?step=accounts&c=c-1");
    expect(screen.queryByRole("button", { name: "Sync now" })).toBeNull();
  });

  it("offers to renew an access that has ended, in place of the sync", () => {
    renderRow({ state: "expired" });
    expect(screen.getByText("Access expired")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Renew access" }).getAttribute("href")).toBe(
      "/banks/connect?renew=c-1",
    );
    expect(screen.queryByRole("button", { name: "Sync now" })).toBeNull();
  });

  it("says the wait a bank asked for as a detail, not as an error", () => {
    renderRow({ waiting: true, nextSync: "15 Nov 2026, 16:00" });
    expect(
      screen.getByText(
        "The bank reached its limit of automatic readings. Next reading at 15 Nov 2026, 16:00.",
      ),
    ).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText("Connected")).toBeTruthy();
  });

  it("cannot sync while the key is refused", () => {
    renderRow({}, true);
    expect((screen.getByRole("button", { name: "Sync now" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
