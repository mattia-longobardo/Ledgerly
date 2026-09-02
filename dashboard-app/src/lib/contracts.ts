/**
 * Shared domain contracts. Producers (clients, parser, jobs) and consumers
 * (queries, pages, components) both import from here so the layers can be
 * built independently.
 */

/**
 * Every account key the app can store in `balance_snapshots`.
 *
 * The five hand-tracked accounts (EToro … Binance) live only in the Teable
 * Allocation table, but they are first-class keys here: since the headline
 * total became a SUM of accounts rather than a read of Teable's `TOTAL`
 * formula column, they are contributors to it and must be typed, not
 * stringly-passed.
 *
 * `total` is kept for the DERIVED headline figure only. Nothing writes it any
 * more — see NET_WORTH_KEYS and `src/lib/calc/networth.ts`.
 */
export const ACCOUNT_KEYS = [
  "ing",
  "revolut_total",
  "revolut_main",
  "revolut_savings",
  "revolut_holidays",
  "fideuram",
  "cometa",
  "etoro",
  "buddy_bank",
  "isybank",
  "mediolanum",
  "binance",
  "total",
] as const;

export type AccountKey = (typeof ACCOUNT_KEYS)[number];

/**
 * The STATIC contributors to net worth — the four accounts the app manages
 * itself. Net worth is their sum plus every hand-tracked account, and nothing
 * else: `total` is never one of them, because summing a column that already sums
 * other columns is how the figure went wrong in the first place.
 *
 * `ing` and `revolut_total` come from Wallet; `fideuram` and `cometa` from the
 * Teable Allocation table. The hand-tracked contributors USED to be listed here
 * too, but they are no longer static — they live in the `tracked_accounts`
 * registry and are read at query time (`_lib/accounts.ts`), so an account can be
 * added or deleted without editing this file. That is why this list is the four
 * managed keys alone.
 */
export const NET_WORTH_KEYS = [
  "ing",
  "revolut_total",
  "fideuram",
  "cometa",
] as const;

export type NetWorthKey = (typeof NET_WORTH_KEYS)[number];

export type SourceKind = "wallet" | "teable";

/** Every figure carries provenance and age so the UI can stamp "as of". */
export interface Valued {
  value: number | null;
  capturedAt: Date | null;
  stale: boolean;
  source: SourceKind | "postgres";
}

export interface AccountBalance extends Valued {
  key: AccountKey;
  label: string;
  subAccounts?: AccountBalance[];
}

export interface MonthPoint {
  month: string;
  value: number | null;
}

export interface Series {
  key: string;
  label: string;
  points: MonthPoint[];
}

/**
 * How old a figure may be before the UI stamps it "stale". This is a DISPLAY
 * budget and nothing else — it says when the owner should stop trusting a
 * number, not when a job should go and fetch a new one. The two used to be one
 * constant, which is why moving Wallet off the hourly sweep would otherwise
 * have painted ING, Revolut and the three Revolut sub-accounts as stale for
 * 23 h 45 m of every day.
 *
 * `wallet`: refreshed once a day at 12:00 Europe/Rome (Wallet itself syncs at
 * noon, so polling harder buys nothing). 26 h rather than 24 h so a late cron,
 * the DST hour and the `curl --retry` tail cannot flip the badge on a run that
 * actually succeeded.
 * `teable`: refreshed by the hourly sweep.
 * `history`: chart data, refreshed at most daily.
 */
export const DISPLAY_STALENESS_MS = {
  wallet: 26 * 60 * 60 * 1000,
  teable: 60 * 60 * 1000,
  history: 24 * 60 * 60 * 1000,
} as const;

/**
 * How old the read cache may be before a JOB refetches it. Only the sweep needs
 * one: it runs hourly regardless, so it asks this before spending an upstream
 * call. Wallet has no entry on purpose — its cron schedule IS its gate, and a
 * second gate would only ever suppress the one refresh of the day.
 */
export const REFRESH_STALENESS_MS = {
  teable: 60 * 60 * 1000,
} as const;

/**
 * The headline total is a sum over sources with very different cadences
 * (Wallet daily, Teable hourly but carrying values the owner last typed in
 * months ago). Judging it by the strictest contributor's budget would leave it
 * permanently stale, so it gets one explicit budget of its own, set to the
 * slowest refresh cadence feeding it.
 */
export const NET_WORTH_STALENESS_MS = DISPLAY_STALENESS_MS.wallet;

export type Confidence = "high" | "medium" | "low";

export interface FieldExtraction<T = string | number | null> {
  value: T;
  confidence: Confidence;
  rules: T | null;
  llm: T | null;
  note?: string;
}

export const PAYSLIP_FIELDS = [
  "gross",
  "net",
  "taxes",
  "fundContribEmployee",
  "fundContribEmployer",
  "ferieBalance",
  "rolBalance",
  "permessiBalance",
  "ferieTakenHours",
  "rolTakenHours",
] as const;

export type PayslipField = (typeof PAYSLIP_FIELDS)[number];

export interface PayslipExtraction {
  parserVersion: string;
  month: string | null;
  isThirteenth: boolean;
  textSource: "pdf" | "ocr";
  fields: Partial<Record<PayslipField, FieldExtraction<number | null>>>;
  checks: SanityCheck[];
  llmError?: string;
}

export interface SanityCheck {
  id: string;
  label: string;
  passed: boolean;
  detail?: string;
}

export type JobName =
  | "monthly_snapshot"
  | "payslip_ingest"
  | "sweep"
  | "wallet_refresh"
  | "trek_sync"
  | "monthly_close"
  | "wallet_accounts_sync";

export type JobStatus =
  | "running"
  | "success"
  | "success_after_retry"
  | "already_done"
  | "failed"
  | "poisoned"
  | "missed";

export interface JobResult {
  job: JobName;
  status: JobStatus;
  detail?: Record<string, unknown>;
  error?: string;
}

/** Thrown by clients when an upstream payload fails its Zod contract. */
export class UpstreamError extends Error {
  constructor(
    readonly service: "teable" | "wallet" | "paperless" | "gotify" | "trek",
    message: string,
    readonly detail?: unknown,
    readonly retryable = false,
  ) {
    super(`[${service}] ${message}`);
    this.name = "UpstreamError";
  }
}
