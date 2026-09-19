import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  AreaLine,
  Bars,
  MiniBars,
  extentOf,
  segmentsOf,
  Sparkline,
  StackedArea,
  stackLayers,
  strokesOf,
} from "./chart";

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

describe("stackLayers", () => {
  it("piles each layer on the ones below it, so the top edge is the total", () => {
    const { bands, top, bottom } = stackLayers(
      [
        [100, 200],
        [50, 60],
      ],
      2,
    );
    expect(bands).toEqual([
      { lower: [0, 0], upper: [100, 200] },
      { lower: [100, 200], upper: [150, 260] },
    ]);
    expect(top).toEqual([150, 260]);
    expect(bottom).toEqual([0, 0]);
  });

  it("counts an account with no balance yet as nothing, and leaves a month nobody knows as a gap", () => {
    const { bands, top } = stackLayers(
      [
        [null, 100, null],
        [null, null, null],
      ],
      3,
    );
    expect(bands[0].upper).toEqual([null, 100, null]);
    expect(bands[1]).toEqual({ lower: [null, 100, null], upper: [null, 100, null] });
    expect(top).toEqual([null, 100, null]);
  });

  it("stacks a negative balance below zero instead of eating into the others", () => {
    const { bands, top, bottom } = stackLayers([[300], [-50]], 1);
    expect(bands[1]).toEqual({ lower: [0], upper: [-50] });
    expect(top).toEqual([300]);
    expect(bottom).toEqual([-50]);
  });
});

describe("StackedArea", () => {
  it("draws one band per account and still says the numbers in text", () => {
    const { container } = render(
      <StackedArea
        layers={[
          { label: "Arancio", color: "#2563eb", values: [100, 200] },
          { label: "Revolut", color: "#dc2626", values: [50, 60] },
        ]}
        total={[150, 260]}
        summary="Net worth from January to February, ending at 2,60 €."
        yLabels={["3 €", "0 €"]}
        xLabels={["Jan", "Feb"]}
      />,
    );
    expect(container.querySelectorAll("path[data-band]")).toHaveLength(2);
    expect(screen.getByText("Net worth from January to February, ending at 2,60 €.")).toBeInTheDocument();
  });
});

describe("Bars", () => {
  it("draws nothing for a step that did not change, rather than a hairline on zero", () => {
    const { container } = render(
      <Bars values={[0, 500, -300, null, 0]} summary="Changes." yLabels={["5", "0", "-5"]} xLabels={[]} />,
    );
    expect(container.querySelectorAll("rect")).toHaveLength(2);
  });
});

describe("MiniBars", () => {
  it("scales to the target, caps a column above it and draws nothing for an unknown period", () => {
    render(
      <MiniBars
        values={[null, 200, 400, 600]}
        labels={["a", "b", "c", "d"]}
        xLabels={["J", "F", "M", "A"]}
        summary="Pocket history"
        target={400}
      />,
    );
    const heights = screen.getAllByTestId("mini-bar").map((bar) => bar.style.height);
    expect(heights).toEqual(["0px", "50%", "100%", "100%"]);
    expect(screen.getByTestId("mini-bars-target")).toBeInTheDocument();
    expect(screen.getByText("Pocket history")).toBeInTheDocument();
  });

  it("leaves headroom above the highest value without a target", () => {
    render(<MiniBars values={[115]} labels={["a"]} xLabels={["J"]} summary="s" />);
    // 115 against a top of 115 × 1.15: the tallest column stops at about 87 %.
    expect(parseFloat(screen.getByTestId("mini-bar").style.height)).toBeCloseTo(86.96, 1);
    expect(screen.queryByTestId("mini-bars-target")).toBeNull();
  });
});
