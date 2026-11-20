import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";
import messages from "../../../../../../messages/en.json";
import { FilterBar } from "./filter-bar";
import { parseExpensesQuery } from "./filters";

const push = vi.hoisted(() => vi.fn());

vi.mock("@ledgerly/ui/router", async (original) => ({
  ...(await original<object>()),
  useRouter: () => ({ push }),
}));

const CASA = "11111111-1111-4111-8111-111111111111";
const SVAGO = "22222222-2222-4222-8222-222222222222";

function renderBar(raw: Record<string, string>) {
  push.mockClear();
  render(
    <NextIntlClientProvider locale="en" messages={messages} timeZone="Europe/Rome">
      <FilterBar
        query={parseExpensesQuery(raw, "2026-09-15")}
        categories={[
          { id: CASA, name: "Casa", color: "#1", count: 3 },
          { id: SVAGO, name: "Svago", color: "#2", count: 1 },
        ]}
        accounts={[]}
        uncategorisedCount={2}
        typeCounts={{}}
        locale="en"
      />
    </NextIntlClientProvider>,
  );
}

describe("FilterBar", () => {
  it("writes the payee search as the GET form did: every other parameter, then q", async () => {
    renderBar({ q: "old", cat: CASA, sort: "amount", preset: "lastMonth" });
    const field = screen.getByRole("searchbox", { name: "Search by payee" });
    await userEvent.clear(field);
    await userEvent.type(field, "netfl{Enter}");
    expect(push).toHaveBeenCalledWith(`/expenses?preset=lastMonth&cat=${CASA}&sort=amount&q=netfl`);
  });

  it("toggles a category, and Uncategorised, in the address the menu links wrote", async () => {
    renderBar({ cat: CASA, off: "1" });
    await userEvent.click(screen.getByRole("button", { name: "1 category" }));
    await userEvent.click(screen.getByRole("option", { name: /Svago/ }));
    expect(push).toHaveBeenLastCalledWith(`/expenses?off=1&cat=${CASA}%2C${SVAGO}`);
    await userEvent.click(screen.getByRole("option", { name: /To categorise/ }));
    expect(push).toHaveBeenLastCalledWith(`/expenses?off=1&cat=${CASA}%2Cnone`);
    await userEvent.click(screen.getByRole("option", { name: /Casa/ }));
    expect(push).toHaveBeenLastCalledWith("/expenses?off=1");
    await userEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(push).toHaveBeenLastCalledWith("/expenses?off=1");
  });

  it("opens the types menu as a popover from its button, and Escape closes it (UI-EXP-3)", async () => {
    renderBar({ off: "1" });
    const trigger = screen.getByRole("button", { name: "All types" });
    await userEvent.click(trigger);
    expect(screen.getByRole("link", { name: /^Transfers/ })).toHaveAttribute(
      "href",
      "/expenses?off=1&type=transfer",
    );
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    await userEvent.keyboard("{Escape}");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  // PeriodBar writes the period parameters first, as on Accounts; the old row wrote a preset last.
  // Same parameters, same values: the parser reads them by name.
  const sorted = (href: string | null) => {
    const [path, search = ""] = (href ?? "").split("?");
    const params = new URLSearchParams(search);
    params.sort();
    return `${path}?${params}`;
  };

  it("keeps the period links of the stepper and the presets", () => {
    renderBar({ cat: CASA, off: "2", sort: "amount" });
    expect(screen.getByRole("link", { name: "Previous period" })).toHaveAttribute(
      "href",
      `/expenses?off=3&cat=${CASA}&sort=amount`,
    );
    expect(sorted(screen.getByRole("link", { name: "Last month" }).getAttribute("href"))).toBe(
      sorted(`/expenses?cat=${CASA}&sort=amount&preset=lastMonth`),
    );
  });
});
