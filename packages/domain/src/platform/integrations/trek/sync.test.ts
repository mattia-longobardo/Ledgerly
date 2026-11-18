// The pure part of a Trek pass: which days to send and which to take back. No database.
import { describe, expect, it } from "vitest";
import { splitForTrek } from "./sync";

/** All working days: 2026-06-16 is a Tuesday, the 17th a Wednesday. */
const TUE = "2026-06-16";
const WED = "2026-06-17";

describe("splitForTrek", () => {
  const day = (
    on: string,
    kind: "vacation" | "rol" | "comp",
    pending: "none" | "upsert" | "delete",
    fraction = 1,
  ) => ({
    id: `${on}-${kind}`,
    on,
    kind,
    fraction,
    pending,
    trekFraction: null,
    trekKind: null,
  });

  it("separates what to send from what to take back", () => {
    const split = splitForTrek([day(TUE, "vacation", "upsert"), day(WED, "vacation", "delete")]);
    expect(split.desired).toEqual([{ date: TUE, fraction: 1, kind: "vacation" }]);
    expect(split.removals).toEqual([WED]);
  });

  it("sends a settled day too, so a day Trek has lost comes back by itself", () => {
    const split = splitForTrek([day(TUE, "vacation", "none")]);
    expect(split.desired).toEqual([{ date: TUE, fraction: 1, kind: "vacation" }]);
  });

  it("names vacation whatever the kind is, since Trek has neither ROL nor anything else", () => {
    const split = splitForTrek([day(TUE, "rol", "upsert"), day(WED, "comp", "upsert")]);
    expect(split.desired).toEqual([
      { date: TUE, fraction: 1, kind: "vacation" },
      { date: WED, fraction: 1, kind: "vacation" },
    ]);
  });

  it("adds the halves of one date up into the single row Trek keeps", () => {
    const split = splitForTrek([day(TUE, "vacation", "upsert", 0.5), day(TUE, "rol", "upsert", 0.5)]);
    expect(split.desired).toEqual([{ date: TUE, fraction: 1, kind: "vacation" }]);
    expect(split.removals).toEqual([]);
  });

  it("never sends more than a whole day, whatever the date carries", () => {
    const split = splitForTrek([
      day(TUE, "vacation", "upsert", 0.5),
      day(TUE, "rol", "upsert", 0.5),
      day(TUE, "comp", "upsert", 0.5),
    ]);
    expect(split.desired).toEqual([{ date: TUE, fraction: 1, kind: "vacation" }]);
  });

  it("takes a date back only once nothing of ours is left on it", () => {
    // Half the day goes: Trek keeps its row, shrunk to the half that stays. Nothing is removed.
    const split = splitForTrek([day(TUE, "vacation", "delete", 0.5), day(TUE, "rol", "none", 0.5)]);
    expect(split.desired).toEqual([{ date: TUE, fraction: 0.5, kind: "vacation" }]);
    expect(split.removals).toEqual([]);
  });
});
