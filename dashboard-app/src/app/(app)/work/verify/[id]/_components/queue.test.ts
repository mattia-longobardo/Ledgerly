import { describe, expect, it } from "vitest";
import { orderQueue, placeInQueue, successorOf, type QueueEntry } from "./queue";

const entry = (id: number, month: string, isThirteenth = false): QueueEntry => ({
  id,
  month,
  isThirteenth,
});

// Deliberately shuffled: the queue order must come from the sort, not the input.
const queue: QueueEntry[] = [
  entry(3, "2025-03"),
  entry(13, "2025-12", true),
  entry(1, "2025-01"),
  entry(12, "2025-12"),
];

describe("orderQueue", () => {
  it("sorts by month, then puts the tredicesima last within its month", () => {
    expect(orderQueue(queue).map((e) => e.id)).toEqual([1, 3, 12, 13]);
  });

  it("does not mutate the input", () => {
    const input = [...queue];
    orderQueue(input);
    expect(input.map((e) => e.id)).toEqual([3, 13, 1, 12]);
  });
});

describe("placeInQueue", () => {
  it("reports a 1-based position with both neighbours", () => {
    const placement = placeInQueue(queue, 3);
    expect(placement.position).toBe(2);
    expect(placement.total).toBe(4);
    expect(placement.prev?.id).toBe(1);
    expect(placement.next?.id).toBe(12);
  });

  it("has no previous at the head and no next at the tail", () => {
    expect(placeInQueue(queue, 1).prev).toBeNull();
    expect(placeInQueue(queue, 13).next).toBeNull();
  });

  it("reports no position for a payslip outside the queue", () => {
    const placement = placeInQueue(queue, 99);
    expect(placement.position).toBeNull();
    expect(placement.next?.id).toBe(1);
  });
});

describe("successorOf", () => {
  it("moves to the next pending payslip", () => {
    const remaining = queue.filter((e) => e.id !== 3);
    expect(successorOf(remaining, entry(3, "2025-03"))).toBe(12);
  });

  it("falls back to the last one left behind when nothing follows", () => {
    const remaining = [entry(1, "2025-01"), entry(3, "2025-03")];
    expect(successorOf(remaining, entry(13, "2025-12", true))).toBe(3);
  });

  it("skips over the current payslip when it is still pending", () => {
    expect(successorOf(queue, entry(3, "2025-03"))).toBe(12);
  });

  it("returns null when the current payslip is the only one left", () => {
    expect(successorOf([entry(3, "2025-03")], entry(3, "2025-03"))).toBeNull();
  });

  it("returns null on an empty queue", () => {
    expect(successorOf([], entry(3, "2025-03"))).toBeNull();
  });
});
