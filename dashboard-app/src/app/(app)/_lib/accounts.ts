import { type MonthPoint } from "@/lib/contracts";
import { fromCents, toCents } from "@/lib/calc/money";
import { netWorth, type NetWorthContributor } from "@/lib/calc/networth";
import { classify } from "@/lib/calc/staleness";
import { latestBalances, monthlyHistory } from "@/lib/repo/balances";
import { list as listTrackedAccounts } from "@/lib/repo/tracked-accounts";
import type { TrackedAccount } from "@/lib/db/schema";
import { addMonths, monthKey } from "@/lib/time";

/** Accounts the app reads itself. Everything else in Teable is hand-tracked. */
export const APP_MANAGED_KEYS = ["fideuram", "cometa", "ing", "revolut_total"] as const;
export const REVOLUT_SUB_KEYS = ["revolut_main", "revolut_savings", "revolut_holidays"] as const;

/** The derived headline figure. Nothing stores this key any more. */
export const TOTAL_KEY = "total";

/**
 * Static labels for the accounts the app owns. The hand-tracked accounts are
 * NOT here any more — their labels live in the `tracked_accounts` registry, so
 * the owner can rename one without a code change and a deleted account carries
 * no orphaned label.
 */
const LABELS: Record<string, string> = {
  total: "Total",
  fideuram: "Fideuram",
  cometa: "Fondo Cometa",
  ing: "ING",
  revolut_total: "Revolut",
  revolut_main: "Main",
  revolut_savings: "Savings",
  revolut_holidays: "Holidays",
};

export function accountLabel(key: string): string {
  return LABELS[key] ?? key;
}

export interface AccountView {
  key: string;
  label: string;
  /** The raw Postgres numeric string — handed straight to the format helpers. */
  balance: string | null;
  capturedAt: Date | null;
  stale: boolean;
  source: "wallet" | "teable" | "postgres";
  points: MonthPoint[];
  /**
   * Registry-driven visibility. Only meaningful for hand-tracked accounts;
   * everything else is always visible. Hiding drops the row from the LIST only —
   * a hidden account still contributes to the net-worth total.
   */
  visible: boolean;
}

export interface AccountsSnapshot {
  byKey: Map<string, AccountView>;
  /**
   * Net worth: Σ of the per-account latest known values — the four managed
   * accounts plus EVERY hand-tracked account, hidden ones included. NOT Teable's
   * `TOTAL` column, which omits Fondo Cometa and, on app-written rows, every
   * hand-tracked account too.
   */
  total: AccountView;
  managed: AccountView[];
  revolutSubs: AccountView[];
  /**
   * The hand-tracked accounts from the registry, individually, in the owner's
   * display order. Each carries its own `visible` flag; consumers render the
   * visible ones as separate rows. Hidden accounts stay in this array (so the
   * total and Settings can still see them) — filter on `visible` to render.
   */
  handTracked: AccountView[];
  /** Oldest capture across everything shown, for the page-level "as of". */
  oldestCapturedAt: Date | null;
  anyStale: boolean;
  earliestMonth: string | null;
}

function emptyView(key: string, tracked?: TrackedAccount): AccountView {
  return {
    key,
    label: tracked?.label ?? accountLabel(key),
    balance: null,
    capturedAt: null,
    stale: true,
    source: tracked ? "teable" : "postgres",
    points: [],
    visible: tracked?.visible ?? true,
  };
}

/**
 * One read of the snapshot cache plus one read of its monthly history. A stale
 * value still renders — last known value plus a badge — so a dead upstream API
 * can never blank the page.
 *
 * Which hand-tracked accounts exist is read from the `tracked_accounts`
 * registry, not a hardcoded array: an account listed there is valued even when
 * Teable no longer has its column (the sweep writes it a 0), which is what keeps
 * a column-less account pinned at 0 rather than vanishing.
 */
export async function loadAccounts(historyMonths = 13): Promise<AccountsSnapshot> {
  const tracked = await listTrackedAccounts();
  const trackedBySlug = new Map(tracked.map((t) => [t.slug, t]));
  const handKeys = tracked.map((t) => t.slug);

  const keys = [...APP_MANAGED_KEYS, ...handKeys, ...REVOLUT_SUB_KEYS];
  const since = addMonths(monthKey(new Date()), -(historyMonths - 1));

  const [latest, history] = await Promise.all([
    latestBalances(keys),
    monthlyHistory(keys, since),
  ]);

  const pointsByKey = new Map<string, MonthPoint[]>();
  for (const row of history) {
    const list = pointsByKey.get(row.accountKey) ?? [];
    list.push({ month: row.month, value: fromCents(toCents(row.balance)) });
    pointsByKey.set(row.accountKey, list);
  }
  for (const list of pointsByKey.values()) list.sort((a, b) => (a.month < b.month ? -1 : 1));

  // Reconcile the current month against the authoritative latest value.
  //
  // `monthlyHistory` and `latestBalances` read the same table with different
  // tie-breaks and can disagree for the current month. `monthlyHistory`
  // deliberately DEMOTES the sweep's `latest` rows so a Teable correction that
  // was backfilled as a history row can surface (see repo/balances.ts) — but
  // that same demotion lets a STALE intra-month reading win. A hand-tracked
  // cell that read 820 at 13:07 and was emptied (→ 0) by the 15:30 sweep still
  // has its 820 `kind:null` row outrank both the 0 `latest` row and the 00:00
  // history 0, so the account's current-month point comes back 820 while its
  // authoritative latest balance is 0. Summed across the hand-tracked accounts
  // the total SERIES then diverged from the scalar total (34 713.59 vs the
  // correct 23 228.78 on 2026-09-01), which is the wrong sum the chart drew.
  //
  // `latestBalances` is the newest known value and its capture is "now", so it
  // always belongs to the current month — and, being a snapshot, the account
  // always already has a current-month point from `monthlyHistory`. Overwrite
  // that point (replace only, never insert) with the latest value: the final
  // point of every account curve — and therefore of the summed total curve —
  // then equals its own headline figure. Only the latest balance's own month is
  // touched, so a managed account whose current month is a genuine gap keeps its
  // carry-forward and is never forced to 0.
  for (const row of latest) {
    const list = pointsByKey.get(row.accountKey);
    if (!list) continue;
    // `latestBalances` runs through drizzle's raw `db.execute`, which hands back
    // `captured_at` as a STRING, not a Date — the `LatestBalance.capturedAt: Date`
    // type is aspirational here. `monthKey`→`romeDate`→`Intl…format(string)`
    // coerces to NaN and throws "Invalid time value"; `new Date(...)` normalises
    // both a string and a real Date. (`classify` below already tolerates the
    // string, which is why only this reconciliation line crashed the page.)
    const month = monthKey(new Date(row.capturedAt));
    const point = list.find((p) => p.month === month);
    if (point) point.value = fromCents(toCents(row.balance));
  }

  const byKey = new Map<string, AccountView>();
  for (const key of keys) byKey.set(key, emptyView(key, trackedBySlug.get(key)));

  for (const row of latest) {
    const source = row.source === "wallet" ? "wallet" : "teable";
    const info = classify(row.capturedAt, source);
    const t = trackedBySlug.get(row.accountKey);
    byKey.set(row.accountKey, {
      key: row.accountKey,
      label: t?.label ?? accountLabel(row.accountKey),
      balance: row.balance,
      capturedAt: info.capturedAt,
      stale: info.stale,
      source,
      points: pointsByKey.get(row.accountKey) ?? [],
      visible: t?.visible ?? true,
    });
  }

  const managed = APP_MANAGED_KEYS.map((k) => byKey.get(k) ?? emptyView(k));
  const revolutSubs = REVOLUT_SUB_KEYS.map((k) => byKey.get(k) ?? emptyView(k));

  // Raw hand-tracked views (a missing snapshot is still null here) feed the
  // total, where a missing hand-tracked account is a 0-effect gap.
  const handTrackedRaw = tracked.map((t) => byKey.get(t.slug) ?? emptyView(t.slug, t));

  const total = buildTotal([...managed, ...handTrackedRaw]);
  byKey.set(total.key, total);

  // For the LIST, a hand-tracked account with no value is worth 0 (empty cell /
  // column gone / not yet synced) — "cella vuota vale 0". Coercing null → 0 here
  // changes no sum: the total already added a missing hand-tracked account as 0.
  const handTracked = handTrackedRaw.map((v) =>
    v.balance === null ? { ...v, balance: "0.00" } : v,
  );
  for (const v of handTracked) byKey.set(v.key, v);

  const shown = [total, ...managed];
  const stamps = shown
    .map((a) => a.capturedAt)
    .filter((d): d is Date => d !== null)
    .sort((a, b) => a.getTime() - b.getTime());

  const allMonths = [...pointsByKey.values()].flat().map((p) => p.month).sort();

  return {
    byKey,
    total,
    managed,
    revolutSubs,
    handTracked,
    oldestCapturedAt: stamps[0] ?? null,
    anyStale: shown.some((a) => a.stale),
    earliestMonth: allMonths[0] ?? null,
  };
}

function toContributor(account: AccountView): NetWorthContributor {
  return {
    key: account.key,
    balance: account.balance,
    capturedAt: account.capturedAt,
    points: account.points,
  };
}

/**
 * The headline figure and its own chart, from one definition.
 *
 * `source` is "postgres" because this number is computed here, in process, out
 * of the cached rows — it is not something any single upstream reported, and
 * pretending it came from Wallet or Teable would put the wrong provenance on a
 * badge. Its staleness comes from `netWorth`, which judges the oldest
 * contributor against one explicit budget rather than inheriting the strictest
 * per-source one; see the note in `src/lib/calc/networth.ts`.
 *
 * Every hand-tracked account is a contributor, hidden ones included: hiding an
 * account removes its row from the list, never its value from the total.
 */
function buildTotal(contributors: readonly AccountView[]): AccountView {
  const result = netWorth(contributors.map(toContributor));
  return {
    key: TOTAL_KEY,
    label: accountLabel(TOTAL_KEY),
    balance: result.balance,
    capturedAt: result.capturedAt,
    stale: result.stale,
    source: "postgres",
    points: result.points,
    visible: true,
  };
}
