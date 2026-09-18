import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AreaLine, extentOf, segmentsOf, Sparkline, strokesOf } from "./chart";

const BOX = { width: 100, height: 20, pad: 0 };

describe("extentOf", () => {
  it("always includes zero, so a balance is read against it", () => {
    expect(extentOf([{ values: [100, 200] }])).toEqual({ low: 0, high: 200 });
  });

  it("opens a range for a flat series instead of dividing by zero", () => {
    expect(extentOf([{ values: [5, 5] }])).toEqual({ low: 0, high: 5 });
    expect(extentOf([{ values: [0, 0] }])).toEqual({ low: 0, high: 1 });
  });

  it("answers for a series with no known value at all", () => {
    expect(extentOf([{ values: [null, null] }])).toEqual({ low: 0, high: 1 });
  });

  it("reaches below zero when a balance does", () => {
    expect(extentOf([{ values: [-50, 100] }])).toEqual({ low: -50, high: 100 });
  });
});

describe("segmentsOf", () => {
  it("breaks the line at a gap instead of drawing through it", () => {
    const runs = segmentsOf([0, 10, null, 10], { low: 0, high: 10 }, BOX);
    expect(runs).toHaveLength(2);
    expect(runs[0]).toHaveLength(2);
    expect(runs[1]).toHaveLength(1);
  });

  it("puts the highest value at the top and the lowest at the bottom", () => {
    const [run] = segmentsOf([0, 10], { low: 0, high: 10 }, BOX);
    expect(run[0].y).toBe(20);
    expect(run[1].y).toBe(0);
  });

  it("has nothing to draw when every value is unknown", () => {
    expect(segmentsOf([null, null], { low: 0, high: 1 }, BOX)).toEqual([]);
  });
});

describe("strokesOf", () => {
  const extent = { low: 0, high: 10 };

  it("draws one solid stroke for a series nothing is estimated in", () => {
    const strokes = strokesOf([1, 2, 3], [false, false, false], extent, BOX);
    expect(strokes.map((stroke) => [stroke.dashed, stroke.points.length])).toEqual([[false, 3]]);
  });

  it("dashes every step that touches an estimated month, and joins the strokes where they meet (F2.5)", () => {
    const strokes = strokesOf([1, 2, 3, 4], [true, true, false, false], extent, BOX);
    expect(strokes.map((stroke) => [stroke.dashed, stroke.points.length])).toEqual([
      [true, 3],
      [false, 2],
    ]);
    // The solid stroke starts where the dashed one ends: no gap in the line.
    expect(strokes[1].points[0]).toEqual(strokes[0].points[2]);
  });

  it("still breaks at a gap, and draws nothing for a lone point", () => {
    const strokes = strokesOf([1, null, 3, 4], [true, false, false, false], extent, BOX);
    expect(strokes.map((stroke) => [stroke.dashed, stroke.points.length])).toEqual([[false, 2]]);
  });
});

describe("AreaLine", () => {
  it("carries a text summary, so the numbers are not only in the picture", () => {
    render(
      <AreaLine
        values={[1, 2, 3]}
        summary="Net worth from Jan to Mar, ending at 3."
        yLabels={["3", "0"]}
        xLabels={["Jan", "Mar"]}
      />,
    );
    expect(screen.getByText("Net worth from Jan to Mar, ending at 3.")).toBeInTheDocument();
  });
});

describe("Sparkline", () => {
  it("is decorative: the row it sits in already states the numbers", () => {
    const { container } = render(<Sparkline values={[1, 2]} />);
    expect(container.querySelector("svg")).toHaveAttribute("aria-hidden");
  });
});
