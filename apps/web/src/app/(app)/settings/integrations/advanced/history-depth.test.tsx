import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import messages from "../../../../../../../../messages/en.json";
import { HistoryDepth } from "./history-depth";

const action = vi.fn();
const refresh = vi.fn();

vi.mock("../connection-actions", () => ({
  runConnectionAction: (...args: unknown[]) => action(...args),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh }) }));

const T = messages.settings.connections.advanced.history;

function renderControl() {
  render(
    <NextIntlClientProvider locale="en" messages={messages} timeZone="Europe/Rome">
      <HistoryDepth connectionId="c1" months={12} choices={[12, 24, 60]} />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("HistoryDepth", () => {
  it("starts on the depth the connection has, and offers only the depths of the provider", () => {
    renderControl();
    expect(screen.getByLabelText(T.label)).toHaveValue("12");
    expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual([
      "12 months",
      "24 months",
      "60 months",
    ]);
  });

  it("downloads the history again at the depth picked, through the one action of a connection", async () => {
    action.mockResolvedValueOnce({ ok: true, toast: "History downloaded again" });
    renderControl();
    await userEvent.selectOptions(screen.getByLabelText(T.label), "60");
    await userEvent.click(screen.getByRole("button", { name: T.action }));
    expect(action).toHaveBeenCalledWith("c1", "history", 60);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("says why nothing was downloaded, in the server's own sentence", async () => {
    action.mockResolvedValueOnce({ ok: false, message: "An update is already running. Try again shortly." });
    renderControl();
    await userEvent.click(screen.getByRole("button", { name: T.action }));
    expect(await screen.findByRole("alert")).toHaveTextContent("An update is already running.");
    expect(refresh).not.toHaveBeenCalled();
  });
});
