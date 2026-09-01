import { describe, expect, it } from "vitest";
import { DISPLAY_STALENESS_MS } from "@/lib/contracts";
import { classify, isStale, snapshotGrace } from "./staleness";

const NOW = new Date("2026-08-01T12:00:00Z");

function ago(ms: number): Date {
  return new Date(NOW.getTime() - ms);
}

describe("isStale", () => {
  it("is exact at the threshold", () => {
    const max = DISPLAY_STALENESS_MS.wallet;
    expect(isStale(ago(max - 1), max, NOW)).toBe(false);
    expect(isStale(ago(max), max, NOW)).toBe(false);
    expect(isStale(ago(max + 1), max, NOW)).toBe(true);
  });

  it("treats a missing capture as stale", () => {
    expect(isStale(null, DISPLAY_STALENESS_MS.teable, NOW)).toBe(true);
    expect(isStale(undefined, DISPLAY_STALENESS_MS.teable, NOW)).toBe(true);
    expect(isStale("not a date", DISPLAY_STALENESS_MS.teable, NOW)).toBe(true);
  });

  it("accepts ISO strings and future timestamps", () => {
    expect(isStale("2026-08-01T11:55:00Z", DISPLAY_STALENESS_MS.teable, NOW)).toBe(false);
    expect(isStale("2026-08-01T13:00:00Z", DISPLAY_STALENESS_MS.teable, NOW)).toBe(false);
  });
});

describe("classify", () => {
  const HOUR = 60 * 60_000;

  it("uses the per-source DISPLAY budget", () => {
    // Wallet is refreshed once a day at 12:00 Europe/Rome, so its display
    // budget is 26 h — 24 h plus room for cron jitter, the DST hour and the
    // curl --retry tail. It was 15 minutes while Wallet rode the hourly sweep;
    // leaving it there would have painted ING, Revolut and the three Revolut
    // sub-accounts stale for 23 h 45 m of every day.
    expect(classify(ago(20 * 60_000), "wallet", NOW).stale).toBe(false);
    expect(classify(ago(20 * HOUR), "wallet", NOW).stale).toBe(false);
    expect(classify(ago(27 * HOUR), "wallet", NOW).stale).toBe(true);

    expect(classify(ago(20 * 60_000), "teable", NOW).stale).toBe(false);
    expect(classify(ago(20 * HOUR), "teable", NOW).stale).toBe(true);
    expect(classify(ago(20 * HOUR), "history", NOW).stale).toBe(false);
  });

  it("pins the budgets so a cadence change has to come here first", () => {
    expect(DISPLAY_STALENESS_MS.wallet).toBe(26 * HOUR);
    expect(DISPLAY_STALENESS_MS.teable).toBe(1 * HOUR);
    expect(DISPLAY_STALENESS_MS.history).toBe(24 * HOUR);
  });

  it("reports the age and budget it used", () => {
    const info = classify(ago(90_000), "wallet", NOW);
    expect(info).toEqual({
      source: "wallet",
      capturedAt: ago(90_000),
      ageMs: 90_000,
      maxAgeMs: DISPLAY_STALENESS_MS.wallet,
      stale: false,
    });
  });

  it("reports a null age when nothing was ever captured", () => {
    const info = classify(null, "history", NOW);
    expect(info.ageMs).toBeNull();
    expect(info.capturedAt).toBeNull();
    expect(info.stale).toBe(true);
  });
});

describe("snapshotGrace", () => {
  const at = (iso: string) => new Date(`${iso}T12:00:00Z`);

  it("is due on and before the firing day", () => {
    expect(snapshotGrace("2026-08-01", at("2026-08-01"))).toBe("due");
    expect(snapshotGrace("2026-08-01", at("2026-07-31"))).toBe("due");
  });

  it("stays in the 3-day grace window", () => {
    expect(snapshotGrace("2026-08-01", at("2026-08-02"))).toBe("in_grace");
    expect(snapshotGrace("2026-08-01", at("2026-08-04"))).toBe("in_grace");
  });

  it("is missed beyond the window", () => {
    expect(snapshotGrace("2026-08-01", at("2026-08-05"))).toBe("missed");
    expect(snapshotGrace("2026-06-01", at("2026-08-05"))).toBe("missed");
  });

  it("honours a custom grace length", () => {
    expect(snapshotGrace("2026-08-01", at("2026-08-05"), 5)).toBe("in_grace");
    expect(snapshotGrace("2026-08-01", at("2026-08-02"), 0)).toBe("missed");
  });
});
