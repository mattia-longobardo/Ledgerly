import { describe, expect, it } from "vitest";
import { rangeLabel } from "./ranges";

describe("rangeLabel", () => {
  it("names a single month and spells anything else out", () => {
    expect(rangeLabel({ from: "2026-09-01", to: "2026-09-30" }, "en")).toBe("September 2026");
    expect(rangeLabel({ from: "2026-07-01", to: "2026-09-30" }, "en")).toBe("1 Jul 2026 – 30 Sep 2026");
    expect(rangeLabel({ from: "2026-09-01", to: "2026-09-30" }, "it")).toBe("settembre 2026");
  });
});
