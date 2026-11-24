import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import messages from "../../../../../../../messages/en.json";
import {
  type ActionKind,
  ConnectionRow,
  type ConnectionRowProps,
  type RowStatusValue,
} from "./connection-row";

const action = vi.fn();
const push = vi.fn();
const refresh = vi.fn();

vi.mock("./connection-calls", async (original) => ({
  ...(await original<object>()),
  runConnectionCall: (...args: unknown[]) => action(...args),
}));
vi.mock("@ledgerly/ui/router", async (original) => ({
  ...(await original<object>()),
  useRouter: () => ({ push, refresh }),
}));

const C = messages.settings.connections;

function row(patch: Partial<ConnectionRowProps> = {}): ConnectionRowProps {
  return {
    id: "c1",
    name: "North Bank",
    detail: "2 accounts",
    status: {
      value: "ok",
      text: "Updated 2 hours ago",
      at: "2026-11-15T08:00:00.000Z",
      title: "15 Nov 2026, 09:00",
      action: null,
    },
    notice: null,
    history: [],
    historyMore: null,
    menu: [{ kind: "advanced", label: C.actions.advanced, href: "/settings/plugins/advanced?c=c1" }],
    ...patch,
  };
}

function renderRow(
  props: ConnectionRowProps,
  extra: { handled?: ActionKind[]; onAction?: (kind: ActionKind) => void; compact?: boolean } = {},
) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages} timeZone="Europe/Rome">
      <ConnectionRow {...props} {...extra} />
    </NextIntlClientProvider>,
  );
}

const status = (value: RowStatusValue, text: string, kind?: ActionKind, href?: string) => ({
  value,
  text,
  at: null,
  title: null,
  action: kind ? { kind, label: C.actions[kind], ...(href ? { href } : {}) } : null,
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ConnectionRow", () => {
  it.each([
    ["ok", C.status.ok],
    ["running", C.status.running],
    ["late", C.status.late],
    ["action", C.status.action],
    ["manual", C.status.manual],
    ["paused", C.status.paused],
    ["absent", C.status.absent],
  ] as const)("says the state %s in a word, beside the dot", (value, word) => {
    renderRow(row({ status: status(value, "the sentence") }));
    expect(screen.getByText(word)).toBeInTheDocument();
    expect(screen.getByText("the sentence")).toBeInTheDocument();
    expect(screen.getByTestId("connection-row")).toHaveAttribute("data-status", value);
  });

  it("puts the sentence in a <time> with the full instant as its title", () => {
    renderRow(row());
    const time = screen.getByText("Updated 2 hours ago");
    expect(time.tagName).toBe("TIME");
    expect(time).toHaveAttribute("datetime", "2026-11-15T08:00:00.000Z");
    expect(time).toHaveAttribute("title", "15 Nov 2026, 09:00");
  });

  it("has no button for a connection that is up to date or being read", () => {
    renderRow(row());
    expect(screen.queryByRole("button", { name: C.actions.update })).not.toBeInTheDocument();
  });

  it("updates through the one action, says what came and asks the page again", async () => {
    action.mockResolvedValueOnce({ ok: true, names: { name: "North Bank", provider: "Enable Banking" } });
    renderRow(row({ status: status("late", "Last update yesterday.", "update") }));
    await userEvent.click(screen.getByRole("button", { name: C.actions.update }));
    expect(action).toHaveBeenCalledWith("c1", "update");
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows a refusal under the row, in the server's own sentence, and no toast", async () => {
    action.mockResolvedValueOnce({
      ok: false,
      refusal: "provider_down",
      names: { name: "North Bank", provider: "Enable Banking" },
    });
    renderRow(row({ status: status("late", "Last update yesterday.", "update") }));
    await userEvent.click(screen.getByRole("button", { name: C.actions.update }));
    expect(await screen.findByRole("alert")).toHaveTextContent("North Bank is not responding.");
    expect(refresh).not.toHaveBeenCalled();
  });

  it("says the network is gone when the action cannot be reached", async () => {
    action.mockRejectedValueOnce(new Error("offline"));
    renderRow(row({ status: status("late", "Last update yesterday.", "update") }));
    await userEvent.click(screen.getByRole("button", { name: C.actions.update }));
    expect(await screen.findByRole("alert")).toHaveTextContent(C.codes.network);
  });

  it("makes the action of a page a link, and the first one when something has to be done", () => {
    renderRow(
      row({
        status: status("action", "Access to North Bank has expired.", "renew", "/banks/connect?renew=c1"),
      }),
    );
    const link = screen.getByRole("link", { name: C.actions.renew });
    expect(link).toHaveAttribute("href", "/banks/connect?renew=c1");
  });

  it("hands the parent the kinds the parent does itself", async () => {
    const onAction = vi.fn();
    renderRow(
      row({
        status: status("action", "The key is no longer valid.", "replaceKey"),
        menu: [{ kind: "disconnect", label: C.actions.disconnect, danger: true }],
      }),
      { handled: ["replaceKey", "disconnect"], onAction },
    );
    await userEvent.click(screen.getByRole("button", { name: C.actions.replaceKey }));
    expect(onAction).toHaveBeenLastCalledWith("replaceKey");
    await userEvent.click(screen.getByRole("button", { name: "North Bank" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: C.actions.disconnect }));
    expect(onAction).toHaveBeenLastCalledWith("disconnect");
    expect(action).not.toHaveBeenCalled();
  });

  it("opens the pages of the menu", async () => {
    renderRow(row());
    await userEvent.click(screen.getByRole("button", { name: "North Bank" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: C.actions.advanced }));
    expect(push).toHaveBeenCalledWith("/settings/plugins/advanced?c=c1");
  });

  it("keeps the history closed, and opens it with a button that says so", async () => {
    renderRow(
      row({
        history: [
          {
            at: "2026-11-15T07:02:00.000Z",
            when: "today 08:02",
            outcome: "ok",
            text: "12 new transactions",
            byYou: true,
          },
          {
            at: "2026-11-14T19:01:00.000Z",
            when: "yesterday 20:01",
            outcome: "failed",
            text: "North Bank is not responding.",
            byYou: false,
          },
        ],
        historyMore: "/settings/plugins/advanced?c=c1",
      }),
    );
    const toggle = screen.getByRole("button", { name: C.history.toggle });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    const list = screen.getByRole("list", { name: "History of North Bank" });
    const items = within(list).getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent(`today 08:02${C.history.ok}12 new transactions · ${C.history.byYou}`);
    expect(items[1]).toHaveTextContent(`yesterday 20:01${C.history.failed}North Bank is not responding.`);
    expect(items[1]).not.toHaveTextContent(C.history.byYou);
    expect(screen.getByRole("link", { name: C.history.all })).toHaveAttribute(
      "href",
      "/settings/plugins/advanced?c=c1",
    );
  });

  it("says a history with nothing in it is empty", async () => {
    renderRow(row());
    await userEvent.click(screen.getByRole("button", { name: C.history.toggle }));
    expect(screen.getByText(C.history.empty)).toBeInTheDocument();
  });

  it("warns that an access is about to end, with the way to renew it", async () => {
    renderRow(
      row({
        notice: {
          text: "Access to North Bank expires in 12 days.",
          action: { kind: "renew", label: C.actions.renew, href: "/banks/connect?renew=c1" },
        },
      }),
    );
    expect(screen.getByRole("status")).toHaveTextContent("Access to North Bank expires in 12 days.");
    await userEvent.click(within(screen.getByRole("status")).getByRole("button", { name: C.actions.renew }));
    expect(push).toHaveBeenCalledWith("/banks/connect?renew=c1");
  });

  it("is the short form on an account's page: word, sentence and the action as a link", async () => {
    action.mockResolvedValueOnce({ ok: true, names: { name: "North Bank", provider: "Enable Banking" } });
    renderRow(row({ status: status("paused", "Enable Banking is not active.", "enable") }), {
      compact: true,
    });
    expect(screen.getByTestId("connection-status")).toHaveAttribute("data-status", "paused");
    expect(screen.getByText(C.status.paused)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: C.history.toggle })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: C.actions.enable }));
    expect(action).toHaveBeenCalledWith("c1", "enable");
  });
});
