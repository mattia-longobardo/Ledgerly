import { describe, expect, it } from "vitest";
import { allocatedThrough, availableInSource, figures, initialAt, monthsInclusive } from "./figures";
const monthly = { id: "a", amount: "100.00", recurrence: "monthly" as const, effectiveFrom: "2026-01-01", effectiveTo: null, sourceKind: "none" as const, sourceId: null };
describe("allocations are planning values (spec §5.6, R6-2)", () => {
  it("counts a monthly allocation once per calendar month from its start through asOf", () => {
    expect(allocatedThrough([monthly], "2026-03-31")).toBe("300.00");
    expect(allocatedThrough([monthly], "2025-12-31")).toBe("0.00");
    expect(allocatedThrough([{ ...monthly, effectiveTo: "2026-02-28" }], "2026-06-30")).toBe("200.00");
  });
  it("counts a once allocation only from its effective date", () => {
    const once = { ...monthly, id: "b", recurrence: "once" as const, amount: "50.00", effectiveFrom: "2026-02-10" };
    expect(allocatedThrough([once], "2026-02-09")).toBe("0.00");
    expect(allocatedThrough([once], "2026-02-10")).toBe("50.00");
  });
  it("picks the initial amount version effective at asOf", () => {
    const v = [{ initialAmount: "1000.00", effectiveFrom: "2026-01-01" }, { initialAmount: "1500.00", effectiveFrom: "2026-04-01" }];
    expect(initialAt(v, "2026-03-31")).toBe("1000.00");
    expect(initialAt(v, "2026-04-01")).toBe("1500.00");
    expect(initialAt([], "2026-04-01")).toBe("0.00");
  });
  it("remaining = initial + allocated − used; goal progress from remaining", () => {
    const f = figures({ versions: [{ initialAmount: "1000.00", effectiveFrom: "2026-01-01" }], allocations: [monthly], usages: [{ amount: "250.00", occurredAt: "2026-02-15" }], goalAmount: "2000.00" }, "2026-03-31");
    expect(f).toEqual({ initial: "1000.00", allocated: "300.00", used: "250.00", remaining: "1050.00", goalProgress: 0.525 });
  });
  it("availability subtracts virtual allocations from the real balance and is null without a balance", () => {
    expect(availableInSource("5000.00", [monthly], "2026-02-28")).toBe("4800.00");
    expect(availableInSource(null, [monthly], "2026-02-28")).toBeNull();
  });
  it("monthsInclusive counts calendar months", () => {
    expect(monthsInclusive("2026-01-15", "2026-03-02")).toBe(3);
    expect(monthsInclusive("2026-03-02", "2026-01-15")).toBe(0);
  });
});
