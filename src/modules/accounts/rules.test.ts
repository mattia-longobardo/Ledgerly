import { describe, expect, it } from "vitest";
import { monthsBetween } from "@/platform/dates";
import {
  alertsFor,
  bucketOf,
  canDelete,
  dailySeries,
  DEFAULT_STALE_AFTER_HOURS,
  deriveMonthEnds,
  estimatedMonths,
  isFutureDate,
  isStale,
  type LocalAccount,
  monthEndSeries,
  normalizeName,
  parseAmount,
  periodEnd,
  reconcileProviderAccounts,
  type RemoteAccount,
  settingsForSynced,
  totalSeries,
} from "./rules";

const MONTHS = monthsBetween("2026-01-01", "2026-04-01");

describe("monthEndSeries", () => {
  it("is null for every month before the account's first balance", () => {
    const points = [{ on: "2026-03-10", cents: 500n }];
    expect(monthEndSeries(points, MONTHS)).toEqual([null, null, 500n, 500n]);
  });

  it("takes the month's last balance and holds it forward", () => {
    const points = [
      { on: "2026-01-05", cents: 100n },
      { on: "2026-01-28", cents: 150n },
      { on: "2026-03-10", cents: 300n },
    ];
    expect(monthEndSeries(points, MONTHS)).toEqual([150n, 150n, 300n, 300n]);
  });

  it("starts from the most recent balance before the window", () => {
    const points = [{ on: "2025-11-20", cents: 900n }];
    expect(monthEndSeries(points, MONTHS)).toEqual([900n, 900n, 900n, 900n]);
  });

  it("draws a straight line between two known months when asked to interpolate", () => {
    const points = [
      { on: "2026-01-31", cents: 100n },
      { on: "2026-04-30", cents: 400n },
    ];
    expect(monthEndSeries(points, MONTHS, "interpolate")).toEqual([100n, 200n, 300n, 400n]);
  });

  it("interpolates from a starting point that lies before the window", () => {
    const points = [
      { on: "2025-12-31", cents: 0n },
      { on: "2026-02-28", cents: 300n },
    ];
    // December and February are two months apart, so January sits halfway between them.
    expect(monthEndSeries(points, MONTHS, "interpolate")).toEqual([150n, 300n, 300n, 300n]);
  });

  it("rounds an interpolated cent half away from zero, in both directions", () => {
    const months = monthsBetween("2026-01-01", "2026-03-01");
    const up = [
      { on: "2026-01-01", cents: 0n },
      { on: "2026-03-01", cents: 1n },
    ];
    expect(monthEndSeries(up, months, "interpolate")).toEqual([0n, 1n, 1n]);
    const down = [
      { on: "2026-01-01", cents: 0n },
      { on: "2026-03-01", cents: -1n },
    ];
    expect(monthEndSeries(down, months, "interpolate")).toEqual([0n, -1n, -1n]);
  });

  it("holds the last value after the final balance, never interpolating past it", () => {
    const points = [
      { on: "2026-01-01", cents: 100n },
      { on: "2026-02-01", cents: 200n },
    ];
    expect(monthEndSeries(points, MONTHS, "interpolate")).toEqual([100n, 200n, 200n, 200n]);
  });

  it("has no months to answer for when the window is empty", () => {
    expect(monthEndSeries([{ on: "2026-01-01", cents: 1n }], [])).toEqual([]);
  });
});

describe("totalSeries", () => {
  it("is null only where every account is unknown, and marks a partial total", () => {
    const totals = totalSeries(
      [
        [null, 100n, 100n],
        [null, null, 50n],
      ],
      3,
    );
    expect(totals).toEqual([
      { total: null, partial: true },
      { total: 100n, partial: true },
      { total: 150n, partial: false },
    ]);
  });
});

describe("bucketOf", () => {
  it("follows the account type", () => {
    expect(bucketOf({ type: "checking", countsAsLiquid: false })).toBe("cash");
    expect(bucketOf({ type: "savings", countsAsLiquid: false })).toBe("savings");
    expect(bucketOf({ type: "pension", countsAsLiquid: false })).toBe("investments");
  });

  it("moves an account marked as liquid into cash, and leaves savings where it is", () => {
    expect(bucketOf({ type: "investment", countsAsLiquid: true })).toBe("cash");
    expect(bucketOf({ type: "savings", countsAsLiquid: true })).toBe("savings");
  });
});

describe("isStale", () => {
  const now = new Date("2026-09-16T12:00:00Z");

  it("treats an account that has never synced as stale", () => {
    expect(isStale(null, DEFAULT_STALE_AFTER_HOURS, now)).toBe(true);
  });

  it("is not stale exactly at the limit, and is one moment later", () => {
    const limit = new Date(now.getTime() - DEFAULT_STALE_AFTER_HOURS * 3_600_000);
    expect(isStale(limit, DEFAULT_STALE_AFTER_HOURS, now)).toBe(false);
    expect(isStale(new Date(limit.getTime() - 1), DEFAULT_STALE_AFTER_HOURS, now)).toBe(true);
  });
});

describe("alertsFor", () => {
  const now = new Date("2026-09-16T12:00:00Z");
  const base = {
    id: "a",
    state: "active" as const,
    origin: "manual" as const,
    lowBalanceCents: 50_000n,
    staleAfterHours: DEFAULT_STALE_AFTER_HOURS,
    lastSyncedAt: null,
  };

  it("warns below the threshold and not at it", () => {
    expect(alertsFor(base, 49_999n, now)).toEqual([{ accountId: "a", kind: "low_balance" }]);
    expect(alertsFor(base, 50_000n, now)).toEqual([]);
  });

  it("says nothing about an account that has no balance yet", () => {
    expect(alertsFor(base, null, now)).toEqual([]);
  });

  it("reports a stale sync only for a synced account", () => {
    expect(alertsFor({ ...base, lowBalanceCents: null }, 10n, now)).toEqual([]);
    expect(alertsFor({ ...base, lowBalanceCents: null, origin: "synced" }, 10n, now)).toEqual([
      { accountId: "a", kind: "stale_sync" },
    ]);
  });

  it("stays quiet about an archived account", () => {
    expect(alertsFor({ ...base, state: "archived", origin: "synced" }, 1n, now)).toEqual([]);
  });

  it("does not call an account stale when the provider no longer has it", () => {
    // `unavailable` already says the provider stopped returning it (spec §7.1), and §7.1 forbids
    // deleting it — so a stale alert on top would never clear and would add nothing. A low balance
    // is still the account's own fact and still worth saying.
    const gone = { ...base, state: "unavailable" as const, origin: "synced" as const };
    expect(alertsFor({ ...gone, lowBalanceCents: null }, 10n, now)).toEqual([]);
    expect(alertsFor(gone, 10n, now)).toEqual([{ accountId: "a", kind: "low_balance" }]);
  });
});

describe("canDelete", () => {
  it("allows deletion only for a manual account nothing points at", () => {
    expect(canDelete({ origin: "manual" }, 0)).toBe(true);
    expect(canDelete({ origin: "manual" }, 1)).toBe(false);
    expect(canDelete({ origin: "synced" }, 0)).toBe(false);
  });
});

describe("settingsForSynced", () => {
  it("keeps the provider's currency whatever the form sent, and lets the type be chosen", () => {
    const input = { name: "Mine", type: "cash", currency: "USD" } as never;
    expect(settingsForSynced(input, { type: "investment", currency: "EUR" })).toMatchObject({
      name: "Mine",
      type: "cash",
      currency: "EUR",
    });
  });
});

describe("isFutureDate", () => {
  it("compares civil dates, so today is allowed and tomorrow is not", () => {
    expect(isFutureDate("2026-09-16", "2026-09-16")).toBe(false);
    expect(isFutureDate("2026-09-17", "2026-09-16")).toBe(true);
  });
});

describe("parseAmount", () => {
  it("reads each number format's own grouping and decimal separators", () => {
    expect(parseAmount("1.234,56", "it-IT")).toBe(123_456n);
    expect(parseAmount("1,234.56", "en-US")).toBe(123_456n);
    expect(parseAmount("1 234,56", "fr-FR")).toBe(123_456n);
  });

  it("accepts a euro sign, a typographic minus and stray spaces", () => {
    expect(parseAmount(" € 1.234,56 ", "it-IT")).toBe(123_456n);
    expect(parseAmount("−4,20", "it-IT")).toBe(-420n);
  });

  it("refuses text that is not an amount", () => {
    expect(() => parseAmount("", "it-IT")).toThrow(RangeError);
    expect(() => parseAmount("abc", "en-US")).toThrow(RangeError);
  });
});

describe("normalizeName", () => {
  it("ignores spacing and case, which is how a provider's name is matched", () => {
    expect(normalizeName("Revolut  Main")).toBe(normalizeName("revolutmain"));
  });
});

describe("reconcileProviderAccounts", () => {
  const remote = (over: Partial<RemoteAccount> = {}): RemoteAccount => ({
    provider: "wallet",
    providerAccountId: "r1",
    name: "Revolut Main",
    type: "checking",
    currency: "EUR",
    ...over,
  });
  const local = (over: Partial<LocalAccount> = {}): LocalAccount => ({
    id: "l1",
    name: "Revolut Main",
    origin: "manual",
    state: "active",
    provider: null,
    providerAccountId: null,
    renamedLocally: false,
    type: "checking",
    retypedLocally: false,
    ...over,
  });

  it("creates an account the provider sends and nothing matches", () => {
    expect(reconcileProviderAccounts([], [remote()], "wallet")).toEqual([
      { action: "create", remote: remote() },
    ]);
  });

  it("adopts a manual account with the same name, ignoring spaces and case", () => {
    const mine = local({ name: "revolut  main" });
    expect(reconcileProviderAccounts([mine], [remote()], "wallet")).toEqual([
      { action: "adopt", id: "l1", remote: remote() },
    ]);
  });

  it("adopts only once: the second run matches on the provider's id instead", () => {
    const adopted = local({ origin: "synced", provider: "wallet", providerAccountId: "r1" });
    expect(reconcileProviderAccounts([adopted], [remote()], "wallet")).toEqual([]);
  });

  it("never adopts a second account into the same provider account", () => {
    const one = local({ id: "l1" });
    const two = local({ id: "l2" });
    const steps = reconcileProviderAccounts([one, two], [remote()], "wallet");
    expect(steps).toEqual([{ action: "adopt", id: "l1", remote: remote() }]);
  });

  it("follows a provider rename while the local name has not been touched", () => {
    const linked = local({ origin: "synced", provider: "wallet", providerAccountId: "r1" });
    expect(reconcileProviderAccounts([linked], [remote({ name: "Revolut Personal" })], "wallet")).toEqual([
      { action: "rename", id: "l1", name: "Revolut Personal" },
    ]);
  });

  it("keeps a locally chosen name even when the provider renames its account", () => {
    const renamed = local({
      origin: "synced",
      provider: "wallet",
      providerAccountId: "r1",
      name: "My spending",
      renamedLocally: true,
    });
    expect(reconcileProviderAccounts([renamed], [remote({ name: "Revolut Personal" })], "wallet")).toEqual(
      [],
    );
  });

  it("follows the provider's type while the local type has not been changed by hand", () => {
    const linked = local({ origin: "synced", provider: "wallet", providerAccountId: "r1", type: "other" });
    expect(reconcileProviderAccounts([linked], [remote({ type: "savings" })], "wallet")).toEqual([
      { action: "retype", id: "l1", type: "savings" },
    ]);
  });

  it("keeps a locally chosen type even when the provider's differs", () => {
    const retyped = local({
      origin: "synced",
      provider: "wallet",
      providerAccountId: "r1",
      type: "cash",
      retypedLocally: true,
    });
    expect(reconcileProviderAccounts([retyped], [remote({ type: "savings" })], "wallet")).toEqual([]);
  });

  it("leaves an account archived locally alone and creates the provider's one beside it", () => {
    const archived = local({ state: "archived" });
    expect(reconcileProviderAccounts([archived], [remote()], "wallet")).toEqual([
      { action: "create", remote: remote() },
    ]);
  });

  it("marks an account the provider stopped sending as unavailable, never deletes it", () => {
    const linked = local({ origin: "synced", provider: "wallet", providerAccountId: "r1" });
    expect(reconcileProviderAccounts([linked], [], "wallet")).toEqual([{ action: "unavailable", id: "l1" }]);
  });

  it("brings an unavailable account back when the provider sends it again", () => {
    const gone = local({
      origin: "synced",
      provider: "wallet",
      providerAccountId: "r1",
      state: "unavailable",
    });
    expect(reconcileProviderAccounts([gone], [remote()], "wallet")).toEqual([
      { action: "reappear", id: "l1" },
    ]);
  });

  it("leaves another provider's accounts untouched", () => {
    const other = local({
      origin: "synced",
      provider: "other",
      providerAccountId: "x1",
      name: "Elsewhere",
    });
    expect(reconcileProviderAccounts([other], [], "wallet")).toEqual([]);
  });

  it("does not archive an account that is already unavailable a second time", () => {
    const gone = local({
      origin: "synced",
      provider: "wallet",
      providerAccountId: "r1",
      state: "unavailable",
    });
    expect(reconcileProviderAccounts([gone], [], "wallet")).toEqual([]);
  });
});

describe("periodEnd", () => {
  const todayOn = "2026-09-16";

  it("is the month or the year still running at offset zero", () => {
    expect(periodEnd("month", 0, todayOn)).toBe("2026-09-01");
    expect(periodEnd("year", 0, todayOn)).toBe("2026-09-01");
  });

  it("steps back one month or one whole year at a time", () => {
    expect(periodEnd("month", 1, todayOn)).toBe("2026-08-01");
    expect(periodEnd("month", 9, todayOn)).toBe("2025-12-01");
    expect(periodEnd("year", 1, todayOn)).toBe("2025-12-01");
    expect(periodEnd("year", 2, todayOn)).toBe("2024-12-01");
  });

  it("never walks into the future, whatever a hand-typed offset says", () => {
    expect(periodEnd("month", -3, todayOn)).toBe("2026-09-01");
    expect(periodEnd("year", -1, todayOn)).toBe("2026-09-01");
  });
});

describe("deriveMonthEnds", () => {
  // A synced account read for the first time on 16 September with 5.000,00 €, and the movements the
  // backfill imported since July (spec §7.1, F2.5).
  const reading = { on: "2026-09-16", cents: 500_000n };
  const daily = [
    { on: "2026-07-03", cents: -10_000n },
    { on: "2026-08-10", cents: 250_000n },
    { on: "2026-08-20", cents: -30_000n },
    { on: "2026-09-02", cents: -20_000n },
    { on: "2026-09-16", cents: -2_000n },
  ];

  it("walks back from the reading, one month end at a time, as far as the movements go", () => {
    expect(deriveMonthEnds([reading], daily)).toEqual([
      // The month before the first movement's: 5.000 − (−100 + 2.500 − 300 − 200 − 20).
      { on: "2026-06-30", cents: 312_000n, derived: true },
      { on: "2026-07-31", cents: 302_000n, derived: true },
      // Only September's two movements lie between: 5.000 + 200 + 20.
      { on: "2026-08-31", cents: 522_000n, derived: true },
    ]);
  });

  it("never writes a month that holds a real reading, and fills a gap between two of them", () => {
    const july = { on: "2026-07-15", cents: 250_000n };
    expect(deriveMonthEnds([july, reading], daily)).toEqual([
      // From the July reading: 2.500 + 100.
      { on: "2026-06-30", cents: 260_000n, derived: true },
      // July has a reading of its own; August is between two and comes from the later one.
      { on: "2026-08-31", cents: 522_000n, derived: true },
    ]);
  });

  it("derives from the nearest reading after the month, not from the latest one", () => {
    const august = { on: "2026-08-25", cents: 600_000n };
    expect(deriveMonthEnds([august, reading], daily)).toContainEqual({
      on: "2026-07-31",
      // 6.000 − (2.500 − 300): the August reading, not September's.
      cents: 380_000n,
      derived: true,
    });
  });

  it("derives nothing without a reading or without movements", () => {
    expect(deriveMonthEnds([], daily)).toEqual([]);
    expect(deriveMonthEnds([reading], [])).toEqual([]);
  });

  it("stops before the month of the latest reading, which the reading itself covers", () => {
    expect(deriveMonthEnds([reading], daily).every((point) => point.on < "2026-09-01")).toBe(true);
  });
});

describe("estimatedMonths", () => {
  const months = monthsBetween("2026-06-01", "2026-09-01");

  it("marks the months whose value comes from a derived point, held forward like the series", () => {
    const points = [
      { on: "2026-06-30", cents: 1n, derived: true },
      { on: "2026-08-31", cents: 2n, derived: true },
      { on: "2026-09-16", cents: 3n },
    ];
    expect(estimatedMonths(points, months)).toEqual([true, true, true, false]);
  });

  it("marks nothing before the first point, which the series shows as a gap", () => {
    expect(estimatedMonths([{ on: "2026-08-31", cents: 1n, derived: true }], months)).toEqual([
      false,
      false,
      true,
      true,
    ]);
  });
});

describe("dailySeries", () => {
  const days = ["2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04", "2026-09-05"];

  it("walks a synced account's balance day by day from the nearest reading and the movements", () => {
    // Read on the 4th at 1.000,00 €; 20 € spent on the 2nd and 5 € on the 5th.
    const series = dailySeries(
      [{ on: "2026-09-04", cents: 100_000n }],
      [
        { on: "2026-09-02", cents: -2_000n },
        { on: "2026-09-05", cents: -500n },
      ],
      days,
      "movements",
    );
    expect(series.values).toEqual([102_000n, 100_000n, 100_000n, 100_000n, 99_500n]);
    // Before the first reading the days are rebuilt, and say so.
    expect(series.estimated).toEqual([true, true, true, false, false]);
  });

  it("takes the next reading when there is one, so a correction is never walked over", () => {
    const series = dailySeries(
      [
        { on: "2026-09-02", cents: 50_000n },
        { on: "2026-09-04", cents: 70_000n },
      ],
      [{ on: "2026-09-03", cents: 30_000n }],
      days,
      "movements",
    );
    expect(series.values.slice(1, 4)).toEqual([50_000n, 70_000n, 70_000n]);
  });

  it("holds a manual account's last entry until the next one, and knows nothing before the first", () => {
    const series = dailySeries(
      [
        { on: "2026-09-02", cents: 10_000n },
        { on: "2026-09-04", cents: 12_000n },
      ],
      [],
      days,
      "hold",
    );
    expect(series.values).toEqual([null, 10_000n, 10_000n, 12_000n, 12_000n]);
    expect(series.estimated).toEqual([false, false, false, false, false]);
  });

  it("knows nothing without a reading at all", () => {
    expect(dailySeries([], [{ on: "2026-09-02", cents: 1n }], days, "movements").values).toEqual([
      null,
      null,
      null,
      null,
      null,
    ]);
  });
});
