// The pure parts of the backup service. No database, no bucket.
import { describe, expect, it } from "vitest";
import { backupKey } from "./service";

describe("backupKey", () => {
  it("sorts by time, because that is how the retention finds the oldest", () => {
    const early = backupKey(new Date("2026-09-21T09:00:00Z"));
    const late = backupKey(new Date("2026-09-21T12:00:00Z"));
    expect([late, early].sort()).toEqual([early, late]);
  });
});
