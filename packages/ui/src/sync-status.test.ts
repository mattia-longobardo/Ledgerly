import { describe, expect, it } from "vitest";
import { since } from "./sync-status";

describe("since", () => {
  const now = new Date("2026-09-16T12:00:00Z");
  const ago = (minutes: number) => new Date(now.getTime() - minutes * 60_000);

  it("has a word for an account that never synced", () => {
    expect(since(null, now)).toEqual({ unit: "never" });
  });

  it("counts minutes, then hours, then days", () => {
    expect(since(ago(5), now)).toEqual({ unit: "minutes", count: 5 });
    expect(since(ago(90), now)).toEqual({ unit: "hours", count: 2 });
    expect(since(ago(60 * 72), now)).toEqual({ unit: "days", count: 3 });
  });

  it("never counts backwards when a reading is slightly in the future", () => {
    expect(since(new Date(now.getTime() + 60_000), now)).toEqual({ unit: "minutes", count: 0 });
  });
});
