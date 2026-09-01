import { describe, expect, it } from "vitest";

const MAX = 2 * 60 * 60 * 1000;
function decide(ageMs: number | null, uptimeMs: number) {
  const trusted = uptimeMs > MAX;
  const stale = ageMs === null || ageMs > MAX;
  return { fails: trusted && stale, label: ageMs === null ? "absent" : stale ? "stale" : "fresh" };
}

describe("health heartbeat gating", () => {
  it("fresh boot, no heartbeat yet -> healthy (no autoheal loop)", () => {
    expect(decide(null, 30_000).fails).toBe(false);
    expect(decide(null, 30_000).label).toBe("absent");
  });
  it("boot 1h in, still no heartbeat -> healthy", () => {
    expect(decide(null, 60 * 60 * 1000).fails).toBe(false);
  });
  it("uptime past window with no heartbeat -> unhealthy", () => {
    expect(decide(null, MAX + 1).fails).toBe(true);
  });
  it("long uptime, fresh heartbeat -> healthy", () => {
    expect(decide(5 * 60 * 1000, 10 * 60 * 60 * 1000).fails).toBe(false);
  });
  it("long uptime, stale heartbeat -> unhealthy", () => {
    expect(decide(MAX + 1, 10 * 60 * 60 * 1000).fails).toBe(true);
  });
  it("exactly at the window boundary is not yet stale", () => {
    expect(decide(MAX, 10 * 60 * 60 * 1000).fails).toBe(false);
  });
});
