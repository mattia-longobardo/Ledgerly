import { describe, expect, it } from "vitest";
import {
  type BalanceReading,
  type ManualMovement,
  accountMode,
  joinedBeforeOpening,
  MANUAL_MOVEMENT_MODES,
  movementBalances,
  movementEffect,
  movementsBeforeOpening,
  withMovementPoints,
} from "./rules";

const at = (day: string, time = "08:00") => new Date(`${day}T${time}:00Z`);
const reading = (on: string, cents: bigint, time?: string): BalanceReading => ({
  on,
  cents,
  capturedAt: at(on, time),
});
/** A movement of `on`, written on `written` (the same day when left out). */
const movement = (on: string, cents: bigint, written = on, time = "12:00"): ManualMovement => ({
  on,
  cents,
  writtenAt: at(written, time),
});

describe("the mode of an account (12-account-modes.md §12.1)", () => {
  it("is by hand for an account with no source", () => {
    expect(accountMode({ type: "cash", origin: "manual" }, null)).toBe("manual");
  });

  it("is read and write when the source creates the movements written here", () => {
    expect(accountMode({ type: "checking", origin: "synced" }, { createsRecords: true })).toBe("two_way");
  });

  it("is read only when the source only reads", () => {
    expect(accountMode({ type: "checking", origin: "synced" }, { createsRecords: false })).toBe("read_only");
  });

  it("is none for an account whose value is a portfolio", () => {
    for (const type of ["investment", "pension", "crypto"] as const) {
      expect(accountMode({ type, origin: "manual" }, null)).toBeNull();
      expect(accountMode({ type, origin: "synced" }, { createsRecords: true })).toBeNull();
    }
  });

  it("takes a manual movement in every mode: read and write too, from N3.1", () => {
    expect(MANUAL_MOVEMENT_MODES).toEqual(["manual", "two_way", "read_only"]);
  });
});

describe("the balance after the manual movements (§12.2)", () => {
  it("is the last reading plus the movements after it, one point for each day", () => {
    const points = movementBalances(
      [reading("2026-11-10", 8_000n)],
      [movement("2026-11-15", -450n), movement("2026-11-15", -1_000n), movement("2026-11-18", 2_000n)],
    );
    expect(points).toEqual([
      { on: "2026-11-15", cents: 6_550n },
      { on: "2026-11-18", cents: 8_550n },
    ]);
  });

  it("leaves a movement dated before the last reading out: the reading holds it (decision 12)", () => {
    // The balance was counted on the 10th; the expense of the 5th is written on the 15th.
    expect(
      movementBalances([reading("2026-11-10", 8_000n)], [movement("2026-11-05", -1_250n, "2026-11-15")]),
    ).toEqual([]);
  });

  it("counts a movement of the reading's own day when it was written after the reading", () => {
    expect(
      movementBalances(
        [reading("2026-11-15", 8_000n, "08:00")],
        [movement("2026-11-15", -450n, "2026-11-15", "10:00")],
      ),
    ).toEqual([{ on: "2026-11-15", cents: 7_550n }]);
  });

  it("gives way to a reading taken later the same day (criterion 7: the bank's balance applies)", () => {
    expect(
      movementBalances(
        [reading("2026-11-15", 100_000n, "20:00")],
        [movement("2026-11-15", -5_000n, "2026-11-15", "10:00")],
      ),
    ).toEqual([]);
  });

  it("starts again at each reading: a movement counts only until the next one", () => {
    const points = movementBalances(
      [reading("2026-11-10", 100_000n), reading("2026-11-16", 100_000n), reading("2026-11-20", 90_000n)],
      [movement("2026-11-15", -5_000n), movement("2026-11-22", -1_000n)],
    );
    expect(points).toEqual([
      { on: "2026-11-15", cents: 95_000n },
      { on: "2026-11-22", cents: 89_000n },
    ]);
  });

  it("writes nothing for an account with no reading, or with no manual movement", () => {
    expect(movementBalances([], [movement("2026-11-15", -450n)])).toEqual([]);
    expect(movementBalances([reading("2026-11-10", 8_000n)], [])).toEqual([]);
    expect(movementBalances([reading("2026-11-20", 8_000n)], [movement("2026-11-15", -450n)])).toEqual([]);
  });

  it("adds a point on a day the app copied a balance on after a movement, so the copy does not win", () => {
    // Reading on 20 October, snapshot copy on the 31st, then an expense of the 30th is written.
    const points = movementBalances(
      [reading("2026-10-20", 10_000n)],
      [movement("2026-10-30", -1_000n, "2026-11-02")],
      ["2026-09-30", "2026-10-31"],
    );
    expect(points).toEqual([
      { on: "2026-10-30", cents: 9_000n },
      { on: "2026-10-31", cents: 9_000n },
    ]);
  });

  it("does not depend on the order it is given the readings and the movements in", () => {
    const readings = [reading("2026-11-16", 100_000n), reading("2026-11-10", 100_000n)];
    const movements = [movement("2026-11-18", -1_000n), movement("2026-11-12", -5_000n)];
    expect(movementBalances(readings, movements)).toEqual(
      movementBalances([...readings].reverse(), [...movements].reverse()),
    );
  });
});

describe("what one more manual movement does to today's balance", () => {
  const readings = [reading("2026-11-10", 8_000n)];

  it("says the balance before and after", () => {
    expect(movementEffect(readings, [], movement("2026-11-15", -450n), "2026-11-15")).toEqual({
      kind: "change",
      before: 8_000n,
      after: 7_550n,
    });
  });

  it("starts from the balance the earlier manual movements already made", () => {
    expect(
      movementEffect(
        readings,
        [movement("2026-11-12", -1_000n)],
        movement("2026-11-15", -450n),
        "2026-11-15",
      ),
    ).toEqual({ kind: "change", before: 7_000n, after: 6_550n });
  });

  it("says the balance does not change for a day the reading already holds, and which reading", () => {
    expect(movementEffect(readings, [], movement("2026-11-05", -450n, "2026-11-15"), "2026-11-15")).toEqual({
      kind: "unchanged",
      readingOn: "2026-11-10",
    });
  });

  it("says nothing for an account with no balance yet", () => {
    expect(movementEffect([], [], movement("2026-11-15", -450n), "2026-11-15")).toEqual({ kind: "none" });
  });

  it("compares a changed movement with the balance that holds its old amount", () => {
    const old = movement("2026-11-15", -450n);
    expect(movementEffect(readings, [old], { ...old, cents: -1_000n }, "2026-11-15", old)).toEqual({
      kind: "change",
      before: 7_550n,
      after: 7_000n,
    });
  });
});

describe("a daily series with the manual movements in it", () => {
  const days = ["2026-11-14", "2026-11-15", "2026-11-16", "2026-11-17"];

  it("moves the days from the movement on, until the next reading", () => {
    const readings = [
      { on: "2026-11-10", cents: 100_000n },
      { on: "2026-11-17", cents: 99_000n },
    ];
    const values = [100_000n, 100_000n, 100_000n, 99_000n];
    expect(withMovementPoints(values, days, readings, [{ on: "2026-11-15", cents: 95_000n }])).toEqual([
      100_000n,
      95_000n,
      95_000n,
      99_000n,
    ]);
  });

  it("leaves the series as it is with no movement point, and a day with no value unknown", () => {
    expect(withMovementPoints([null, 5n, 5n, 5n], days, [{ on: "2026-11-15", cents: 5n }], [])).toEqual([
      null,
      5n,
      5n,
      5n,
    ]);
    expect(
      withMovementPoints(
        [null, 5n, 5n, 5n],
        days,
        [{ on: "2026-11-15", cents: 5n }],
        [{ on: "2026-11-16", cents: 3n }],
      ),
    ).toEqual([null, 5n, 3n, 3n]);
  });
});

describe("the manual movements before the opening (PERS-678)", () => {
  const readings = [reading("2026-11-20", 5_000n), reading("2026-11-10", 0n)];

  it("counts the movements before the first reading, with the earliest day and the opening's", () => {
    const movements = [
      movement("2026-11-08", -1_250n),
      movement("2026-11-05", -450n),
      movement("2026-11-10", -100n),
      movement("2026-11-15", 300n),
    ];
    expect(movementsBeforeOpening(readings, movements)).toEqual({
      count: 2,
      first: "2026-11-05",
      openingOn: "2026-11-10",
    });
  });

  it("is null with none before it, and with no reading at all", () => {
    expect(movementsBeforeOpening(readings, [movement("2026-11-12", -450n)])).toBeNull();
    expect(movementsBeforeOpening([], [movement("2026-11-12", -450n)])).toBeNull();
  });

  it("leaves a movement between two readings to decision 12: the later reading holds it", () => {
    expect(movementsBeforeOpening(readings, [movement("2026-11-15", -450n, "2026-11-25")])).toBeNull();
  });

  it("is counted once the opening moves to the day before the first movement", () => {
    const moved = [reading("2026-11-04", 0n)];
    const before = [movement("2026-11-05", -450n, "2026-11-25")];
    expect(movementsBeforeOpening(moved, before)).toBeNull();
    expect(movementBalances(moved, before)).toEqual([{ on: "2026-11-05", cents: -450n }]);
  });

  it("joins several accounts into one answer: the sum and the earliest day", () => {
    expect(joinedBeforeOpening([])).toBeNull();
    expect(
      joinedBeforeOpening([
        { count: 2, first: "2026-11-05", openingOn: "2026-11-10" },
        { count: 1, first: "2026-10-30", openingOn: "2026-11-01" },
      ]),
    ).toEqual({ count: 3, first: "2026-10-30" });
  });
});
