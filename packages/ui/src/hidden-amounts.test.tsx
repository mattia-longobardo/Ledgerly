import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AMOUNT_MASK, formatMoney, maskAmounts } from "@ledgerly/format/format";
import { HiddenAmounts } from "./hidden-amounts";

const Balance = () => <p>{formatMoney(123456n, "en-US")}</p>;

describe("HiddenAmounts", () => {
  afterEach(() => {
    maskAmounts(false);
  });

  it("hides every amount below it, and shows it again when the choice is off", () => {
    const { rerender } = render(
      <HiddenAmounts hidden>
        <Balance />
      </HiddenAmounts>,
    );
    expect(screen.getByText(AMOUNT_MASK)).toBeInTheDocument();
    rerender(
      <HiddenAmounts hidden={false}>
        <Balance />
      </HiddenAmounts>,
    );
    expect(screen.getByText("€1,234.56")).toBeInTheDocument();
  });
});
