import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";
import messages from "../../../../../../../messages/en.json";
import { SourceWrites } from "./source-writes";

vi.mock("@ledgerly/ui/data", () => ({ useApi: () => ({ data: { rules: [] } }) }));

const NONE = { count: 0, accountIds: [] };

function renderWrites(refused: { count: number; accountIds: string[] }) {
  render(
    <NextIntlClientProvider locale="en" messages={messages} timeZone="Europe/Rome">
      <SourceWrites
        provider="Pursely"
        accountIds={[]}
        waiting={{ count: 3, accountIds: ["acc-1", "acc-2"] }}
        refused={refused}
      />
    </NextIntlClientProvider>,
  );
}

describe("SourceWrites", () => {
  it("says what the source refused, and leads to the movements of its accounts", () => {
    renderWrites({ count: 1, accountIds: ["acc-2"] });
    const link = screen.getByRole("link", {
      name: "Pursely refused the change. Nothing changed in Pursely.",
    });
    expect(link).toHaveAttribute("href", "/expenses?acc=acc-2");
  });

  it("has no refusal line when the source refused nothing", () => {
    renderWrites(NONE);
    expect(screen.queryByText(/refused the change/)).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "3 transactions to send" })).toBeInTheDocument();
  });
});
