// The pure parts of the accounts service. No database.
import { describe, expect, it } from "vitest";
import { snapshotMonthFor } from "./service";

describe("snapshotMonthFor", () => {
  it("covers the month that has just ended", () => {
    expect(snapshotMonthFor("2026-02-01")).toBe("2026-01-01");
    expect(snapshotMonthFor("2026-01-01")).toBe("2025-12-01");
  });
});
