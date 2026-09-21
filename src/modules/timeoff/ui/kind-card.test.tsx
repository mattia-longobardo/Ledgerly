import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { MonthBar } from "../rules";
import { KindCard, MonthBars } from "./kind-card";

function renderCard(overrides: Partial<Parameters<typeof KindCard>[0]> = {}) {
  const { container } = render(
    <KindCard
      label="Vacation"
      allowanceNote="26 d / year"
      value="18"
      valueUnit="days remaining"
      takenNote="5 d taken"
      plannedNote="3 d planned"
      basisNote="Allowance and carry-over, less the days taken and planned"
      takenShare={5 / 26}
      plannedShare={3 / 26}
      tone="primary"
      testId="card"
      {...overrides}
    />,
  );
  return container;
}

/** The two coloured segments of the card's bar, in order. */
function segments(container: HTMLElement): string[] {
  const bar = container.querySelector(".bg-track");
  return [...(bar?.children ?? [])].map((child) => (child as HTMLElement).style.width);
}

describe("KindCard", () => {
  it("always says where the number came from", () => {
    renderCard();
    expect(screen.getByText("Allowance and carry-over, less the days taken and planned")).toBeInTheDocument();
  });

  it("shows an unknown residual as a dash rather than a zero", () => {
    renderCard({ value: "—", takenShare: 0, plannedShare: 0 });
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(segments(renderCard({ value: "—", takenShare: 0, plannedShare: 0 }))).toEqual(["0%", "0%"]);
  });

  it("never lets the two parts overflow the bar", () => {
    // More taken and planned than the allowance ever held: the bar fills, it does not spill.
    const widths = segments(renderCard({ takenShare: 0.9, plannedShare: 0.8 }));
    const total = widths.reduce((sum, width) => sum + Number.parseFloat(width), 0);
    expect(total).toBeLessThanOrEqual(100.001);
    expect(widths[0]).toBe("90%");
  });

  it("survives a share that is not a number", () => {
    // A residual of zero out of zero is 0/0: the card must still render.
    expect(segments(renderCard({ takenShare: Number.NaN, plannedShare: Number.NaN }))).toEqual(["0%", "0%"]);
  });

  it("leaves out the allowance note when nobody stated one", () => {
    renderCard({ allowanceNote: "" });
    expect(screen.queryByText("26 d / year")).not.toBeInTheDocument();
  });
});

const NAMES = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];

function bars(values: Array<[number, number]>): MonthBar[] {
  return values.map(([takenMinutes, plannedMinutes], index) => ({
    month: index + 1,
    takenMinutes,
    plannedMinutes,
  }));
}

describe("MonthBars", () => {
  it("draws all twelve months, empty ones included", () => {
    const { container } = render(
      <MonthBars
        bars={bars(Array.from({ length: 12 }, () => [0, 0] as [number, number]))}
        shortNames={NAMES}
        labelFor={(bar) => `month ${bar.month}`}
      />,
    );
    expect(container.querySelectorAll("[title]")).toHaveLength(12);
  });

  it("scales the bars to the busiest month", () => {
    const values = Array.from({ length: 12 }, () => [0, 0] as [number, number]);
    values[1] = [4, 0];
    values[7] = [2, 0];
    const { container } = render(
      <MonthBars bars={bars(values)} shortNames={NAMES} labelFor={(bar) => `month ${bar.month}`} />,
    );
    const heights = [...container.querySelectorAll("[title]")].map(
      (node) => (node as HTMLElement).style.height,
    );
    expect(heights[1]).toBe("100%");
    expect(heights[7]).toBe("50%");
    expect(heights[0]).toBe("0%");
  });
});
