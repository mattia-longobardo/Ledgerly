// The pure parts of the export service. No database, no bucket.
import { describe, expect, it } from "vitest";
import { exportFileName } from "./service";

const NOW = new Date("2026-09-21T10:00:00Z");

describe("the archive of a person's data", () => {
  it("carries the day it was made", () => {
    expect(exportFileName(NOW)).toBe("ledgerly-2026-09-21.zip");
  });
});
