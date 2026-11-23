import { cleanup, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import { listTodo } from "@ledgerly/api-contract";
import { invalidate } from "@ledgerly/ui/data";
import messages from "../../../../../messages/en.json";
import { hrefOf, TodoCard } from "./todo-card";

function serve(items: unknown[]) {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(JSON.stringify({ items }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    ),
  );
}

afterEach(() => {
  // A read nobody shows any more leaves the cache: the next test reads its own answer.
  cleanup();
  invalidate(listTodo);
  vi.unstubAllGlobals();
});

function renderCard() {
  render(
    <NextIntlClientProvider locale="en" messages={messages} timeZone="Europe/Rome">
      <TodoCard locale="en" />
    </NextIntlClientProvider>,
  );
}

const ITEM = { addon: null, since: "2026-11-28T07:00:00.000Z" };

describe("«To do» of Overview", () => {
  it("lists each item of GET /todo, in its order, with the catalogue's text and a link to its page", async () => {
    serve([
      {
        ...ITEM,
        id: "0190c3c2-7a3e-7c1a-9f4e-2b3c4d5e6f70",
        event: "connection_expiring",
        params: { days: 3, date: "2026-12-01" },
        target: { page: "connection", id: "0190c3c2-7a3e-7c1a-9f4e-2b3c4d5e6f71" },
      },
      {
        ...ITEM,
        id: "0190c3c2-7a3e-7c1a-9f4e-2b3c4d5e6f72",
        event: "transactions_to_categorize",
        params: { count: 12 },
        target: { page: "expenses_review", id: null },
      },
    ]);
    renderCard();
    const links = await screen.findAllByRole("link");
    expect(links.map((link) => [link.textContent, link.getAttribute("href")])).toEqual([
      ["A bank access ends in 3 days, on 1 Dec 2026. Renew it.Open", "/settings/plugins"],
      ["12 transactions to categorizeOpen", "/expenses/review"],
    ]);
  });

  it("draws nothing when there is nothing to do", async () => {
    serve([]);
    renderCard();
    await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(screen.queryByTestId("todo")).not.toBeInTheDocument();
  });

  it("opens the record a target names", () => {
    // A fund opens at the account that holds it (R5b): no redirect through /funds.
    expect(hrefOf({ page: "fund", id: "f1", pageId: "a9" })).toBe("/investments/a9");
    expect(hrefOf({ page: "fund", id: "f1" })).toBe("/investments");
    expect(hrefOf({ page: "budget", id: "b1" })).toBe("/budgets/b1");
    expect(hrefOf({ page: "account", id: "a1" })).toBe("/accounts/a1");
    expect(hrefOf({ page: "payroll_review", id: null })).toBe("/payroll");
    expect(hrefOf({ page: "investments_transfers", id: null })).toBe("/investments");
  });
});
