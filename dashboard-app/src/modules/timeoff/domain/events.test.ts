import { describe, expect, it } from "vitest";
import { plannedByMonth, statusAt, upcoming, type EventLike } from "./events";

const TODAY = "2026-03-10";

function event(over: Partial<EventLike> & { date: string }): EventLike {
  return {
    id: over.date,
    fraction: "1.00",
    typeCode: "vacation",
    status: "planned",
    origin: "manual",
    pendingOp: "none",
    note: null,
    ...over,
  };
}

describe("statusAt", () => {
  it("counts yesterday as taken", () => {
    expect(statusAt(event({ date: "2026-03-09" }), TODAY)).toBe("taken");
  });

  it("leaves today planned — the day is not over", () => {
    expect(statusAt(event({ date: TODAY }), TODAY)).toBe("planned");
  });

  it("leaves tomorrow planned", () => {
    expect(statusAt(event({ date: "2026-03-11" }), TODAY)).toBe("planned");
  });

  it("keeps a cancelled day cancelled however old it is", () => {
    expect(statusAt(event({ date: "2026-01-02", status: "cancelled" }), TODAY)).toBe("cancelled");
  });
});

describe("plannedByMonth", () => {
  it("sums two half days into one working day of hours", () => {
    const months = plannedByMonth(
      [
        event({ date: "2026-03-02", fraction: "0.50" }),
        event({ date: "2026-03-03", fraction: "0.50" }),
      ],
      "vacation",
      "8.00",
    );
    expect(months.get("2026-03")).toBe("8.00");
  });

  it("skips a cancelled day", () => {
    const months = plannedByMonth(
      [
        event({ date: "2026-03-02" }),
        event({ date: "2026-03-03", status: "cancelled" }),
      ],
      "vacation",
      "8.00",
    );
    expect(months.get("2026-03")).toBe("8.00");
  });

  it("ignores every other type", () => {
    const months = plannedByMonth(
      [
        event({ date: "2026-03-02" }),
        event({ date: "2026-03-03", typeCode: "comp" }),
      ],
      "vacation",
      "8.00",
    );
    expect([...months]).toEqual([["2026-03", "8.00"]]);
  });

  it("groups by calendar month", () => {
    const months = plannedByMonth(
      [event({ date: "2026-03-31" }), event({ date: "2026-04-01" })],
      "vacation",
      "8.00",
    );
    expect([...months]).toEqual([["2026-03", "8.00"], ["2026-04", "8.00"]]);
  });

  it("returns nothing for an empty calendar", () => {
    expect([...plannedByMonth([], "vacation", "8.00")]).toEqual([]);
  });
});

describe("upcoming", () => {
  it("sorts ascending and keeps today", () => {
    const rows = upcoming(
      [event({ date: "2026-03-20" }), event({ date: TODAY }), event({ date: "2026-03-09" })],
      TODAY,
    );
    expect(rows.map((r) => r.date)).toEqual([TODAY, "2026-03-20"]);
  });

  it("drops cancelled days", () => {
    const rows = upcoming([event({ date: "2026-03-20", status: "cancelled" })], TODAY);
    expect(rows).toEqual([]);
  });

  it("limits when asked", () => {
    const rows = upcoming(
      [event({ date: "2026-03-20" }), event({ date: "2026-03-11" }), event({ date: "2026-03-12" })],
      TODAY,
      2,
    );
    expect(rows.map((r) => r.date)).toEqual(["2026-03-11", "2026-03-12"]);
  });
});
