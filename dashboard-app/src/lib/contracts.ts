/**
 * Shared domain contracts. Producers (clients, parser, jobs) and consumers
 * (queries, pages, components) both import from here so the layers can be
 * built independently.
 */

/**
 * Every account key the legacy `balance_snapshots` cache can hold — Wallet's
 * accounts plus the five accounts the owner used to type in by hand. Kept as
 * a typed set (not a bare string) because `src/lib/clients/wallet-accounts.ts`
 * and `src/lib/repo/balances.ts` still read and write it: `balance_snapshots`
 * remains the source for the Funds page and stays a read-only archive of the
 * pre-accounts-module history until Phase 9.
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

export type SourceKind = "wallet";

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
 * number, not when a job should go and fetch a new one.
 *
 * `wallet`: refreshed once a day at 12:00 Europe/Rome (Wallet itself syncs at
 * noon, so polling harder buys nothing). 26 h rather than 24 h so a late cron,
 * the DST hour and the `curl --retry` tail cannot flip the badge on a run that
 * actually succeeded.
 * `legacy`: the Funds page's Fideuram/Fondo Cometa balances, hand-typed into
 * `balance_snapshots` by the retired snapshot job. Nothing refreshes them any
 * more, so this budget only says how old a hand-typed figure is allowed to
 * look before the badge flags it — it does not gate a job.
 * `history`: chart data, refreshed at most daily.
 */
export const DISPLAY_STALENESS_MS = {
  wallet: 26 * 60 * 60 * 1000,
  legacy: 60 * 60 * 1000,
  history: 24 * 60 * 60 * 1000,
} as const;

/**
 * The budget `src/lib/calc/networth.ts` judges a summed total against. Used
 * only by the migration reconciliation script now, which recomputes the
 * legacy net-worth figure straight from `balance_snapshots` for comparison
 * against the accounts module's own series.
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
  | "payroll_ingest"
  | "payroll_retention"
  | "sweep"
  | "wallet_refresh"
  | "trek_sync"
  | "monthly_close"
  | "wallet_accounts_sync"
  | "wallet_transactions_sync"
  | "sync_queue"
  | "interest_accrual";

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
    readonly service: "wallet" | "gotify" | "trek",
    message: string,
    readonly detail?: unknown,
    readonly retryable = false,
  ) {
    super(`[${service}] ${message}`);
    this.name = "UpstreamError";
  }
}
