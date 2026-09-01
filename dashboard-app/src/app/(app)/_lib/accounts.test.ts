/**
 * `loadAccounts`, with the two repositories under it mocked. What this suite
 * pins down is the reworked hand-tracked valuation:
 *
 *   - a hand-tracked account with no value is LISTED AT 0 (empty cell / column
 *     gone / never synced) — "cella vuota vale 0";
 *   - a HIDDEN account keeps counting in the net-worth total, it just carries a
 *     visible:false flag the pages filter on;
 *   - the registry, not a hardcoded array, decides which accounts exist.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LatestBalance } from "@/lib/repo/balances";
import type { TrackedAccount } from "@/lib/db/schema";
import { addMonths, monthKey } from "@/lib/time";

const repo = vi.hoisted(() => ({ list: vi.fn() }));
const balances = vi.hoisted(() => ({
  latestBalances: vi.fn(async () => [] as LatestBalance[]),
  monthlyHistory: vi.fn(async () => [] as Array<{ accountKey: string; month: string; balance: string }>),
}));

vi.mock("@/lib/repo/tracked-accounts", () => repo);
vi.mock("@/lib/repo/balances", () => balances);

const { loadAccounts } = await import("./accounts");

function tracked(slug: string, over: Partial<TrackedAccount> = {}): TrackedAccount {
  return {
    slug,
    label: slug,
    teableColumn: slug,
    visible: true,
    sortOrder: 0,
    createdAt: new Date(0),
    ...over,
  };
}

/** A fresh capture so staleness never interferes with the assertions here. */
const NOW = new Date();

function latest(accountKey: string, balance: string, source: "wallet" | "teable" = "teable"): LatestBalance {
  return { accountKey, source, balance, capturedAt: NOW };
}

beforeEach(() => {
  vi.clearAllMocks();
  repo.list.mockResolvedValue([]);
  balances.latestBalances.mockResolvedValue([]);
  balances.monthlyHistory.mockResolvedValue([]);
});

describe("hand-tracked valuation", () => {
  it("lists an account with no snapshot at 0 (empty cell / column gone)", async () => {
    repo.list.mockResolvedValue([tracked("etoro", { label: "EToro", teableColumn: "EToro" })]);
    // No row for etoro at all — the column was deleted, or it was never filled.
    balances.latestBalances.mockResolvedValue([latest("ing", "100.00", "wallet")]);

    const snap = await loadAccounts();

    const etoro = snap.handTracked.find((a) => a.key === "etoro");
    expect(etoro?.balance).toBe("0.00");
    expect(etoro?.visible).toBe(true);
  });

  it("takes a real 0 snapshot as 0, not as 'unknown'", async () => {
    repo.list.mockResolvedValue([tracked("binance", { label: "Binance", teableColumn: "Binance" })]);
    balances.latestBalances.mockResolvedValue([latest("binance", "0.00")]);

    const snap = await loadAccounts();

    expect(snap.handTracked.find((a) => a.key === "binance")?.balance).toBe("0.00");
  });

  it("carries an empty-month 0 through to the series", async () => {
    repo.list.mockResolvedValue([tracked("binance", { teableColumn: "Binance" })]);
    balances.latestBalances.mockResolvedValue([latest("binance", "0.00")]);
    balances.monthlyHistory.mockResolvedValue([
      { accountKey: "binance", month: "2026-06-01", balance: "0.00" },
      { accountKey: "binance", month: "2026-07-01", balance: "1800.00" },
    ]);

    const snap = await loadAccounts();

    const binance = snap.handTracked.find((a) => a.key === "binance");
    expect(binance?.points).toEqual([
      { month: "2026-06-01", value: 0 },
      { month: "2026-07-01", value: 1800 },
    ]);
  });
});

describe("current-month reconciliation with the latest balance", () => {
  // The month `latestBalances` belongs to — its capture is NOW, so the current
  // Rome month. `monthlyHistory` and `latestBalances` can disagree here.
  const THIS_MONTH = monthKey(NOW);
  const LAST_MONTH = addMonths(THIS_MONTH, -1);

  it("overwrites a stale current-month series point with the authoritative latest (empty→0)", async () => {
    repo.list.mockResolvedValue([tracked("buddy_bank", { teableColumn: "Buddy" })]);
    // Scalar source: the emptied hand-tracked cell reads 0 as of now.
    balances.latestBalances.mockResolvedValue([
      latest("ing", "251.00", "wallet"),
      latest("buddy_bank", "0.00"),
    ]);
    // Series source: monthlyHistory still surfaces the pre-empty 820 for the
    // current month — the demoted-`latest` ordering picks a stale hourly row
    // over the 0. This is exactly the divergence the reconciliation fixes.
    balances.monthlyHistory.mockResolvedValue([
      { accountKey: "ing", month: THIS_MONTH, balance: "251.00" },
      { accountKey: "buddy_bank", month: LAST_MONTH, balance: "820.00" },
      { accountKey: "buddy_bank", month: THIS_MONTH, balance: "820.00" },
    ]);

    const snap = await loadAccounts();

    const buddy = snap.handTracked.find((a) => a.key === "buddy_bank");
    // Current month reconciles to the latest value; the past month is untouched.
    expect(buddy?.points.find((p) => p.month === THIS_MONTH)?.value).toBe(0);
    expect(buddy?.points.find((p) => p.month === LAST_MONTH)?.value).toBe(820);

    // The whole point: the total SERIES' final point equals the scalar total,
    // instead of carrying the stale 820 into the summed curve.
    expect(snap.total.balance).toBe("251.00");
    const last = snap.total.points[snap.total.points.length - 1];
    expect(last?.month).toBe(THIS_MONTH);
    expect(last?.value).toBe(251);
  });

  it("tolerates capturedAt arriving as a STRING (drizzle raw execute), not a Date", async () => {
    // `latestBalances` goes through drizzle's raw `db.execute`, which returns
    // `captured_at` as a Postgres timestamp STRING despite the `Date` type. The
    // reconciliation feeds it to `monthKey`→`Intl…format`, which throws
    // "Invalid time value" on a string — the RangeError that blanked Home and
    // Finance. This pins the string path the Date-based mocks never exercised.
    const stringCapture = `${THIS_MONTH.slice(0, 7)}-15 12:00:00+00` as unknown as Date;
    repo.list.mockResolvedValue([tracked("buddy_bank", { teableColumn: "Buddy" })]);
    balances.latestBalances.mockResolvedValue([
      { accountKey: "ing", source: "wallet", balance: "251.00", capturedAt: stringCapture },
      { accountKey: "buddy_bank", source: "teable", balance: "0.00", capturedAt: stringCapture },
    ]);
    balances.monthlyHistory.mockResolvedValue([
      { accountKey: "ing", month: THIS_MONTH, balance: "251.00" },
      { accountKey: "buddy_bank", month: THIS_MONTH, balance: "820.00" },
    ]);

    const snap = await loadAccounts();

    expect(snap.total.balance).toBe("251.00");
    const buddy = snap.handTracked.find((a) => a.key === "buddy_bank");
    expect(buddy?.points.find((p) => p.month === THIS_MONTH)?.value).toBe(0);
  });

  it("never forces a managed account's genuine current-month gap to 0", async () => {
    // Cometa's newest snapshot is LAST month (this month's cell is empty). Its
    // latest balance therefore belongs to last month, so reconciliation touches
    // last month only — the current month stays a gap that carry-forward fills
    // with the real 2000, never a fabricated 0.
    repo.list.mockResolvedValue([]);
    balances.latestBalances.mockResolvedValue([
      { accountKey: "cometa", source: "teable", balance: "2000.00", capturedAt: new Date(NOW.getTime() - 40 * 86_400_000) },
    ]);
    balances.monthlyHistory.mockResolvedValue([
      { accountKey: "cometa", month: LAST_MONTH, balance: "2000.00" },
    ]);

    const snap = await loadAccounts();

    const cometa = snap.byKey.get("cometa");
    // Reconciliation touched last month (the latest balance's own month) and
    // invented no current-month 0. The real 2000 stands.
    expect(cometa?.points).toEqual([{ month: LAST_MONTH, value: 2000 }]);
    const last = snap.total.points[snap.total.points.length - 1];
    expect(last?.value).toBe(2000);
  });
});

describe("hiding", () => {
  it("keeps a hidden account's value in the total but flags it visible:false", async () => {
    repo.list.mockResolvedValue([
      tracked("binance", { label: "Binance", teableColumn: "Binance", visible: false }),
    ]);
    balances.latestBalances.mockResolvedValue([
      latest("ing", "100.00", "wallet"),
      latest("binance", "50.00"),
    ]);

    const snap = await loadAccounts();

    // 100 (ING) + 50 (hidden Binance) — hiding never removes value from the total.
    expect(snap.total.balance).toBe("150.00");

    const binance = snap.handTracked.find((a) => a.key === "binance");
    expect(binance?.visible).toBe(false);
    // It is still in the array (Settings + total see it); the pages drop it by
    // filtering on `visible`.
    expect(snap.handTracked.filter((a) => a.visible).map((a) => a.key)).not.toContain("binance");
  });
});

describe("the registry is the source of truth", () => {
  it("exposes exactly the registered accounts, in registry order", async () => {
    repo.list.mockResolvedValue([
      tracked("etoro", { label: "EToro" }),
      tracked("mediolanum", { label: "Mediolanum" }),
    ]);

    const snap = await loadAccounts();

    expect(snap.handTracked.map((a) => a.key)).toEqual(["etoro", "mediolanum"]);
    expect(snap.handTracked.map((a) => a.label)).toEqual(["EToro", "Mediolanum"]);
  });
});
