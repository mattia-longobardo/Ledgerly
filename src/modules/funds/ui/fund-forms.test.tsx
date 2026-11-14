import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";
import messages from "../../../../messages/en.json";
import { ValuationButton } from "./fund-forms";

const recordValuation = vi.fn<(fundId: string, input: Record<string, string>) => Promise<{ ok: true }>>(
  async () => ({ ok: true }),
);
vi.mock("../actions", () => ({
  recordValuationAction: (fundId: string, input: Record<string, string>) => recordValuation(fundId, input),
  updateValuationAction: vi.fn(),
  deleteValuationAction: vi.fn(),
  setFundStateAction: vi.fn(),
}));

/** "Update value" (screens §8.2): the day, the value and a note, saved as the fund's value of that day. */
describe("ValuationButton", () => {
  it("records the value of a day", async () => {
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <ValuationButton
          fundId="f1"
          fundName="Fondo Alfa"
          today="2026-11-14"
          lastLine={null}
          label="Update value"
        />
      </NextIntlClientProvider>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Update value" }));
    expect(screen.getByRole("dialog", { name: "Update value · Fondo Alfa" })).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText(messages.funds.valuations.form.value), "1200");
    await userEvent.click(screen.getByRole("button", { name: messages.funds.valuations.form.save }));
    await waitFor(() => expect(recordValuation).toHaveBeenCalledOnce());
    expect(recordValuation).toHaveBeenCalledWith("f1", { on: "2026-11-14", value: "1200", note: "" });
  });
});
