import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";
import { ApiError } from "@ledgerly/api-client";
import messages from "../../../messages/en.json";
import { Loaded } from "./loaded";
import { type RouterAdapter, RouterProvider } from "./router";

const replace = vi.fn();
const ROUTER: RouterAdapter = {
  Link: (props) => <a {...props} />,
  useRouter: () => ({ push: vi.fn(), replace, refresh: vi.fn() }),
  usePathname: () => "/budgets",
};

describe("Loaded", () => {
  it("leads a read of an addon that is off to Settings › Addons, and says so", () => {
    render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="Europe/Rome">
        <RouterProvider adapter={ROUTER}>
          <Loaded
            state={{
              data: undefined,
              error: new ApiError(409, "module_inactive", "budgets"),
              loading: false,
              reload: vi.fn(),
            }}
          >
            {() => <p>data</p>}
          </Loaded>
        </RouterProvider>
      </NextIntlClientProvider>,
    );
    expect(screen.getByRole("status")).toHaveTextContent(messages.errors.moduleInactive);
    expect(screen.getByRole("link")).toHaveAttribute("href", "/settings/addons?off=budgets");
    expect(replace).toHaveBeenCalledWith("/settings/addons?off=budgets");
  });
});
