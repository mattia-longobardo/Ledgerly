import { fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";
import messages from "../../../../messages/en.json";
import { type DialogContext, MovementDialog } from "./investment-actions";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/ui/toast", () => ({ notify: vi.fn() }));
vi.mock("../actions", () => ({
  saveMovementAction: vi.fn(),
  savePlatformAction: vi.fn(),
  deletePlatformAction: vi.fn(),
  deleteMovementAction: vi.fn(),
  setValuationAction: vi.fn(),
  deleteValuationAction: vi.fn(),
}));

const context: DialogContext = {
  platforms: [{ id: "p-1", name: "eToro" }],
  numberFormat: "it-IT",
  locale: "en",
  today: "2026-09-23",
  linkOptions: {
    out: [
      { id: "t-1", on: "2026-06-11", cents: 200_000n, payee: "Bonifico eToro", accountName: "ING" },
      { id: "t-2", on: "2026-09-01", cents: 5_000n, payee: "Esselunga", accountName: "ING" },
    ],
    in: [],
  },
};

function renderDialog() {
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <MovementDialog open onOpenChange={vi.fn()} movement={null} platformId="p-1" context={context} />
    </NextIntlClientProvider>,
  );
}

describe("MovementDialog", () => {
  it("keeps working while the year is being typed, when the date is not a date yet", () => {
    renderDialog();
    const date = screen.getByLabelText("Date");
    // What a date field holds half-way through typing "2026": a year of one digit, or nothing.
    for (const partial of ["0002-06-11", "0020-06-11", "0202-06-11", ""]) {
      fireEvent.change(date, { target: { value: partial } });
      expect(screen.getByRole("dialog", { name: "New movement" })).toBeInTheDocument();
    }
    fireEvent.change(date, { target: { value: "2026-06-11" } });
    const options = screen.getAllByRole("option").map((option) => option.textContent);
    // With a real date again, the nearest bank movement comes first.
    expect(options.findIndex((text) => text?.includes("Bonifico eToro"))).toBeLessThan(
      options.findIndex((text) => text?.includes("Esselunga")),
    );
  });
});
