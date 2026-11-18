import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ChartHover } from "./chart-hover";

const POINTS = [
  { label: "Jan 2026", value: "100,00 €" },
  { label: "Feb 2026", value: "200,00 €", note: "+100,00 € change" },
  { label: "Mar 2026", value: "300,00 €" },
];

/** jsdom gives every element a zero-sized box; the overlay measures itself, so it needs one. */
function overlayOf(container: HTMLElement, width = 100): HTMLElement {
  const overlay = container.firstChild as HTMLElement;
  overlay.getBoundingClientRect = () => ({ left: 0, width }) as DOMRect;
  return overlay;
}

describe("ChartHover", () => {
  it("shows nothing until the pointer is over the chart", () => {
    render(<ChartHover points={POINTS} />);
    expect(screen.queryByText("Jan 2026")).not.toBeInTheDocument();
  });

  it("picks the point nearest the pointer, and its note", () => {
    const { container } = render(<ChartHover points={POINTS} />);
    const overlay = overlayOf(container);

    fireEvent.mouseMove(overlay, { clientX: 50 });
    expect(screen.getByText("Feb 2026")).toBeInTheDocument();
    expect(screen.getByText("+100,00 € change")).toBeInTheDocument();

    fireEvent.mouseMove(overlay, { clientX: 100 });
    expect(screen.getByText("Mar 2026")).toBeInTheDocument();
  });

  it("stays inside the chart when the pointer runs past either edge", () => {
    const { container } = render(<ChartHover points={POINTS} />);
    const overlay = overlayOf(container);

    fireEvent.mouseMove(overlay, { clientX: -40 });
    expect(screen.getByText("Jan 2026")).toBeInTheDocument();

    fireEvent.mouseMove(overlay, { clientX: 400 });
    expect(screen.getByText("Mar 2026")).toBeInTheDocument();
  });

  it("clears itself when the pointer leaves", () => {
    const { container } = render(<ChartHover points={POINTS} />);
    const overlay = overlayOf(container);
    fireEvent.mouseMove(overlay, { clientX: 50 });
    fireEvent.mouseLeave(overlay);
    expect(screen.queryByText("Feb 2026")).not.toBeInTheDocument();
  });

  it("does nothing at all without points, rather than reading an empty array", () => {
    const { container } = render(<ChartHover points={[]} />);
    fireEvent.mouseMove(overlayOf(container), { clientX: 50 });
    expect(container.querySelectorAll("div").length).toBe(1);
  });
});
