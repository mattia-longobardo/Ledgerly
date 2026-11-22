import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type RouterAdapter, RouterProvider } from "@ledgerly/ui/router";
import messages from "../../../../../../../messages/en.json";
import { AddonsScreen } from "./addons-screen";

const search = new URLSearchParams();
vi.mock("next/navigation", () => ({ useSearchParams: () => search }));

const refresh = vi.fn();
const ROUTER: RouterAdapter = {
  Link: (props) => <a {...props} />,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh }),
  usePathname: () => "/settings/addons",
};

type Row = { id: string; group: "work" | null; active: boolean; stops: { addon: string; what: string }[] };
let addons: Row[];
const writes: { id: string; active: boolean }[] = [];

function answer(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

beforeEach(() => {
  writes.length = 0;
  search.delete("off");
  addons = [
    { id: "investments", group: null, active: true, stops: [] },
    { id: "funds", group: null, active: true, stops: [] },
    {
      id: "payroll",
      group: "work",
      active: true,
      stops: [
        { addon: "timeoff", what: "payslip_balances" },
        { addon: "funds", what: "payroll_contributions" },
      ],
    },
    { id: "timeoff", group: "work", active: true, stops: [] },
    { id: "budgets", group: null, active: true, stops: [] },
    { id: "subscriptions", group: null, active: true, stops: [] },
    { id: "pockets", group: null, active: true, stops: [] },
    { id: "interests", group: null, active: true, stops: [{ addon: "pockets", what: "interest" }] },
  ];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const put = /\/addons\/(\w+)$/.exec(url);
      if (put && init?.method === "PUT") {
        const { active } = JSON.parse(String(init.body)) as { active: boolean };
        writes.push({ id: put[1], active });
        addons = addons.map((one) => (one.id === put[1] ? { ...one, active } : one));
      }
      return answer({ addons });
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  refresh.mockReset();
});

function renderScreen() {
  render(
    <NextIntlClientProvider locale="en" messages={messages} timeZone="Europe/Rome">
      <RouterProvider adapter={ROUTER}>
        <AddonsScreen />
      </RouterProvider>
    </NextIntlClientProvider>,
  );
}

describe("Settings › Addons", () => {
  it("lists what stops before an addon goes off, and turns it off only once confirmed", async () => {
    renderScreen();
    await userEvent.click(await screen.findByRole("switch", { name: "Payroll" }));
    const dialog = await screen.findByRole("dialog", { name: "Turn off Payroll?" });
    const stops = within(dialog).getByTestId("addon-stops");
    expect(stops).toHaveTextContent("Time off no longer reads the balances from the payslips.");
    expect(stops).toHaveTextContent("Funds no longer gets contributions from the payslips.");
    expect(writes).toEqual([]);

    await userEvent.click(within(dialog).getByRole("button", { name: "Turn off" }));
    await vi.waitFor(() => expect(writes).toEqual([{ id: "payroll", active: false }]));
    // The menu is the layout's: it is drawn again, with no reload of the page.
    await vi.waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(await screen.findByRole("switch", { name: "Payroll" })).toHaveAttribute("aria-checked", "false");
  });

  it("does nothing when the person cancels", async () => {
    renderScreen();
    await userEvent.click(await screen.findByRole("switch", { name: "Budgets" }));
    await userEvent.click(await screen.findByRole("button", { name: "Cancel" }));
    expect(writes).toEqual([]);
  });

  it("turns Payroll and Time off together from Work, without listing what they stop in each other", async () => {
    renderScreen();
    await userEvent.click(await screen.findByRole("switch", { name: "Work" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByTestId("addon-stops")).not.toHaveTextContent("Time off no longer reads");
    expect(within(dialog).getByTestId("addon-stops")).toHaveTextContent("Funds no longer gets contributions");
    await userEvent.click(within(dialog).getByRole("button", { name: "Turn off" }));
    await vi.waitFor(() =>
      expect(writes).toEqual([
        { id: "payroll", active: false },
        { id: "timeoff", active: false },
      ]),
    );
  });

  it("turns an addon on at once, with no question", async () => {
    addons = addons.map((one) => (one.id === "pockets" ? { ...one, active: false } : one));
    renderScreen();
    await userEvent.click(await screen.findByRole("switch", { name: "Pockets" }));
    await vi.waitFor(() => expect(writes).toEqual([{ id: "pockets", active: true }]));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("says why the person is here when a page of an addon that is off sent them", async () => {
    search.set("off", "budgets");
    renderScreen();
    expect(await screen.findByTestId("addon-off")).toHaveTextContent(
      "The page you opened belongs to Budgets",
    );
  });
});
