import { toCents } from "@/lib/calc/money";
import { parseItalianNumber } from "@/lib/format";
import { addMonths, monthKey, monthKeyOf, romeDate } from "@/lib/time";
import type { AccountType } from "../domain/account";

/**
 * The one-off translation from the legacy world — the Teable Allocation table,
 * the `tracked_accounts` / `funds` registries and the Wallet rows cached in
 * `balance_snapshots` — into the accounts module's own shape.
 *
 * Pure on purpose: every decision that needs judgement (which accounts exist,
 * what they are called, which day a figure belongs to, what is deliberately
 * dropped) is taken here, unit-tested, and reviewable before a single row is
 * written. `scripts/migrate-teable.ts` only reads, calls this, and inserts.
 */

export interface TeableImportInput {
  /**
   * The owner the accounts are created for. Carried on the input rather than
   * baked into every planned row: the plan describes ONE user's world, and the
   * script stamps the id when it turns a `PlannedAccount` into a `NewAccount`.
   */
  userId: string;
  tracked: { slug: string; label: string; sortOrder: number; visible: boolean }[];
  funds: { slug: string; name: string }[];
  points: { key: string; month: string; value: number | null }[];
  walletSnapshots: { accountKey: string; balance: string; capturedAt: Date }[];
}

export interface PlannedAccount {
  key: string;
  name: string;
  type: AccountType;
  origin: "manual";
  includeInNetWorth: boolean;
  sortOrder: number;
}

export interface PlannedBalance {
  key: string;
  /** `YYYY-MM-DD` — the day the figure is true for, never the day it was read. */
  asOf: string;
  balance: string;
  source: "migration" | "provider";
}

export interface TeableImportPlan {
  accounts: PlannedAccount[];
  balances: PlannedBalance[];
  skipped: { key: string; reason: string }[];
}

/**
 * `TOTAL` and `Revolut` are sums of columns that are themselves imported, so
 * importing them too would double every euro they cover. `revolut_total` in
 * particular is replaced by the three Wallet sub-accounts.
 */
const DERIVED_KEYS = new Set(["total", "revolut_total"]);
const DERIVED_REASON = "derived figure";

/**
 * Every account the legacy world can produce, in the order they are planned.
 *
 * The names of the Wallet-backed accounts (`ing`, `revolut_*`) are the Wallet
 * account names verbatim: the provider sync adopts an existing account by name,
 * so a mismatch here would leave the migrated history stranded beside a fresh
 * duplicate account.
 */
const DEFAULTS: ReadonlyArray<readonly [string, { name: string; type: AccountType }]> = [
  ["ing", { name: "ING - Salary", type: "checking" }],
  ["etoro", { name: "EToro", type: "investment" }],
  ["buddy_bank", { name: "Buddy Bank", type: "savings" }],
  ["isybank", { name: "IsyBank", type: "savings" }],
  ["mediolanum", { name: "Mediolanum", type: "savings" }],
  ["cometa", { name: "Fondo Cometa", type: "pension_fund" }],
  ["binance", { name: "Binance", type: "investment" }],
  ["fideuram", { name: "Fideuram", type: "investment" }],
  ["revolut_main", { name: "Revolut", type: "checking" }],
  ["revolut_savings", { name: "Savings", type: "savings" }],
  ["revolut_holidays", { name: "Holidays", type: "savings" }],
];

const DEFAULT_BY_KEY = new Map(DEFAULTS);

/**
 * The last day of month `M` (`YYYY-MM-01`): the day before the 1st of the next
 * month, so February and leap years need no table of their own.
 */
export function lastDayOfMonth(month: string): string {
  const next = new Date(`${addMonths(monthKeyOf(month), 1)}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() - 1);
  return next.toISOString().slice(0, 10);
}

/** Integer cents to the two-decimal string the money columns store. */
function centsToString(cents: number): string {
  const abs = Math.abs(cents);
  return `${cents < 0 ? "-" : ""}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

export function planTeableImport(input: TeableImportInput): TeableImportPlan {
  // A registry names the account it registers: the funds table owns Fideuram
  // and Fondo Cometa, `tracked_accounts` owns the hand-typed ones (and wins,
  // since the owner renames those from Settings). Anything neither knows keeps
  // its built-in name.
  const names = new Map<string, string>();
  for (const f of input.funds) names.set(f.slug, f.name);
  for (const t of input.tracked) names.set(t.slug, t.label);
  const orders = new Map(input.tracked.map((t) => [t.slug, t.sortOrder]));

  const skipped = new Map<string, string>();
  const wanted = new Set<string>();

  const skip = (key: string, reason: string): void => {
    if (!skipped.has(key)) skipped.set(key, reason);
  };

  const consider = (key: string): boolean => {
    if (wanted.has(key)) return true;
    if (DERIVED_KEYS.has(key)) {
      skip(key, DERIVED_REASON);
      return false;
    }
    if (!DEFAULT_BY_KEY.has(key)) {
      skip(key, "no account mapping for this key");
      return false;
    }
    wanted.add(key);
    return true;
  };

  // The registries decide which accounts EXIST — one the owner still keeps
  // stays even when Teable no longer has a column for it — and the data adds
  // anything they have forgotten.
  for (const t of input.tracked) consider(t.slug);
  for (const f of input.funds) consider(f.slug);
  for (const p of input.points) consider(p.key);
  for (const w of input.walletSnapshots) consider(w.accountKey);

  const accounts: PlannedAccount[] = DEFAULTS.filter(([key]) => wanted.has(key)).map(([key, def]) => ({
    key,
    name: names.get(key) ?? def.name,
    type: def.type,
    origin: "manual" as const,
    // Everything the legacy total summed counts towards the new one; a hidden
    // hand-tracked account was hidden from the LIST, never from the figure.
    includeInNetWorth: true,
    sortOrder: orders.get(key) ?? 0,
  }));

  // Keyed by account and day so the last figure for a day wins, the way both
  // the Teable pivot and the snapshot cache already read their own tables.
  const migrated = new Map<string, PlannedBalance>();
  for (const point of input.points) {
    if (!wanted.has(point.key)) continue;
    // An empty cell is a gap, never a zero — and never an erasure either: a
    // month whose second row left the column blank keeps the figure the first
    // one stated.
    if (point.value === null) continue;
    const cents = toCents(point.value);
    if (cents === null) {
      skip(point.key, `unreadable Teable value for ${point.month}`);
      continue;
    }
    const asOf = lastDayOfMonth(point.month);
    migrated.set(`${point.key} ${asOf}`, {
      key: point.key,
      asOf,
      balance: centsToString(cents),
      source: "migration",
    });
  }

  const captured = new Map<string, { row: PlannedBalance; at: number }>();
  for (const snapshot of input.walletSnapshots) {
    if (!wanted.has(snapshot.accountKey)) continue;
    const cents = toCents(snapshot.balance);
    if (cents === null) {
      skip(snapshot.accountKey, "unreadable wallet balance");
      continue;
    }
    // Rome, not UTC: the day a balance belongs to is the owner's civil day.
    const asOf = romeDate(snapshot.capturedAt);
    const id = `${snapshot.accountKey} ${asOf}`;
    const at = snapshot.capturedAt.getTime();
    const seen = captured.get(id);
    if (seen && seen.at > at) continue;
    captured.set(id, {
      at,
      row: { key: snapshot.accountKey, asOf, balance: centsToString(cents), source: "provider" },
    });
  }

  const balances = [...migrated.values(), ...[...captured.values()].map((c) => c.row)].sort(
    (a, b) =>
      a.key.localeCompare(b.key) || a.asOf.localeCompare(b.asOf) || a.source.localeCompare(b.source),
  );

  return {
    accounts,
    balances,
    skipped: [...skipped].map(([key, reason]) => ({ key, reason })),
  };
}

/**
 * The shape one row of the exported Allocation table takes — kept identical
 * to what the retired `teable.ts` client parsed off the live API, so a JSON
 * export written before that client was deleted still reads back correctly.
 */
export interface ExportedRecord {
  id: string;
  fields: Record<string, unknown>;
}

export interface ExportedPoint {
  key: string;
  column: string;
  month: string;
  value: number | null;
}

const EXPORTED_DATE_FIELD = "Date";

/**
 * Column name → the key it lands under in `TeableImportInput.points`. `TOTAL`
 * is pivoted too, faithfully, but `planTeableImport` skips it as a derived
 * figure — see `DERIVED_KEYS` above.
 */
const EXPORTED_NUMBER_COLUMNS: ReadonlyArray<readonly [string, string]> = [
  ["ING", "ing"],
  ["EToro", "etoro"],
  ["Buddy Bank", "buddy_bank"],
  ["IsyBank", "isybank"],
  ["Mediolanum", "mediolanum"],
  ["Fondo Cometa", "cometa"],
  ["Binance", "binance"],
  ["Fideuram", "fideuram"],
  ["Revolut", "revolut_total"],
  ["TOTAL", "total"],
];

function toNumber(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === "") return null;
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (typeof raw === "string") return parseItalianNumber(raw);
  return null;
}

function toMonth(raw: unknown): string | null {
  if (typeof raw !== "string" || raw === "") return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return `${raw.slice(0, 7)}-01`;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return monthKey(parsed);
}

/**
 * The pure half of what `teable.ts`'s `pivotToSeries` used to do: rows →
 * `(key, month, value)`, an empty cell staying a gap rather than becoming a
 * zero. Kept here — not in the deleted client — because it has no I/O of its
 * own and `scripts/migrate-teable.ts` needs it whether the rows came from a
 * live read or from a previously written export file.
 */
export function pivotExportedRecords(records: readonly ExportedRecord[]): ExportedPoint[] {
  const points: ExportedPoint[] = [];
  for (const record of records) {
    const month = toMonth(record.fields[EXPORTED_DATE_FIELD]);
    if (!month) continue;
    for (const [column, key] of EXPORTED_NUMBER_COLUMNS) {
      if (!(column in record.fields)) continue;
      points.push({ key, column, month, value: toNumber(record.fields[column]) });
    }
  }
  points.sort((a, b) => (a.month === b.month ? a.key.localeCompare(b.key) : a.month.localeCompare(b.month)));
  return points;
}
