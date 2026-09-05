import { describe, expect, it } from "vitest";
import { orderQueue, placeInQueue, reviewHref, successorOf, type QueueEntry } from "./queue";

const entry = (id: string, month: string, isThirteenth = false): QueueEntry => ({ id, month, isThirteenth });

describe("orderQueue", () => {
  it("orders by month ascending", () => {
    const ordered = orderQueue([entry("c", "2026-08-01"), entry("a", "2026-06-01"), entry("b", "2026-07-01")]);
    expect(ordered.map((e) => e.id)).toEqual(["a", "b", "c"]);
  });

  it("puts an ordinary payslip before that month's tredicesima", () => {
    const ordered = orderQueue([entry("t", "2025-12-01", true), entry("o", "2025-12-01")]);
    expect(ordered.map((e) => e.id)).toEqual(["o", "t"]);
  });

  it("breaks a remaining tie on the id, so order is never left to insertion luck", () => {
    const ordered = orderQueue([entry("b", "2026-08-01"), entry("a", "2026-08-01")]);
    expect(ordered.map((e) => e.id)).toEqual(["a", "b"]);
  });

  it("does not mutate its input", () => {
    const input = [entry("b", "2026-08-01"), entry("a", "2026-07-01")];
    orderQueue(input);
    expect(input.map((e) => e.id)).toEqual(["b", "a"]);
  });
});

describe("placeInQueue", () => {
  const queue = [entry("a", "2026-06-01"), entry("b", "2026-07-01"), entry("c", "2026-08-01")];

  it("reports a 1-based position with both neighbours", () => {
    expect(placeInQueue(queue, "b")).toEqual({ total: 3, position: 2, prev: queue[0], next: queue[2] });
  });

  it("reports null neighbours at the ends", () => {
    expect(placeInQueue(queue, "a").prev).toBeNull();
    expect(placeInQueue(queue, "c").next).toBeNull();
  });

  it("offers the first entry when the current one has left the queue", () => {
    expect(placeInQueue(queue, "gone")).toEqual({ total: 3, position: null, prev: null, next: queue[0] });
  });

  it("handles an empty queue", () => {
    expect(placeInQueue([], "a")).toEqual({ total: 0, position: null, prev: null, next: null });
  });
});

describe("successorOf", () => {
  it("offers the next one still pending", () => {
    const remaining = [entry("b", "2026-07-01"), entry("c", "2026-08-01")];
    expect(successorOf(remaining, entry("a", "2026-06-01"))).toBe("b");
  });

  it("falls back to the last one left behind, so skipping never strands anybody", () => {
    const remaining = [entry("a", "2026-06-01"), entry("b", "2026-07-01")];
    expect(successorOf(remaining, entry("c", "2026-08-01"))).toBe("b");
  });

  it("never offers the entry just dealt with", () => {
    expect(successorOf([entry("a", "2026-06-01")], entry("a", "2026-06-01"))).toBeNull();
  });

  it("answers null for an empty remainder", () => {
    expect(successorOf([], entry("a", "2026-06-01"))).toBeNull();
  });
});

describe("reviewHref", () => {
  it("points at the Company payroll review route, not the retired /work one", () => {
    expect(reviewHref("018f-abc")).toBe("/company/payroll/018f-abc");
  });
});
