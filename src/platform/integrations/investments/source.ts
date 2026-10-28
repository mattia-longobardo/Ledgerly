/**
 * The contract every investment provider implements (docs/design/investments.md §3.1): read only,
 * no database, no `server-only`, so the mapping is testable on the fixtures of the spike. The
 * module `investments` owns the pass that calls it, the lock, the transactions and the engine.
 *
 * Amounts leave a source as plain decimal strings in the currency they are in (`nativeAmount`,
 * `nativeCurrency`), or as cents already in the account's currency where the provider converted
 * them itself (eToro's `displayCurrency`). The pass converts the rest at the ECB rate of the day.
 */
import type { CivilDate } from "@/platform/dates";
import type { Cents } from "@/platform/money";

/** The outcome of a key check (§5.2): an allowlist, so anything not known to be read only is refused. */
export type KeyCheckResult = "read-only" | "write" | "unknown-flag" | "unverifiable";

export interface KeyCheck {
  result: KeyCheckResult;
  /** Only the names and the boolean values of what the API said, never the key (§1.2). */
  permissions: Record<string, boolean>;
  /** Binance `ipRestrict`; `null` where the API does not say. */
  ipRestricted: boolean | null;
  /** The provider's own id of the person (eToro `gcid`), the external account of every reading. */
  externalAccountId: string | null;
}

/** An asset as the provider names it; the module finds or creates the `investment_assets` row. */
export interface AssetRef {
  /** The provider's stable id of the asset (eToro `instrumentID`, a coin's code). */
  externalId: string;
  class: "stock" | "etf" | "fund" | "bond" | "crypto" | "stablecoin" | "cash" | "other";
  name: string;
  symbol: string;
  /** The currency the asset is quoted in. */
  currency: string;
}

export interface SnapshotPosition {
  asset: AssetRef;
  product: string;
  /** Plain decimal. */
  quantity: string;
  /** Plain decimal in `priceCurrency`, `null` when the provider gave none. */
  price: string | null;
  priceCurrency: string | null;
  priceSource: string;
  /** In the account's currency; `null` when the provider gave no value for it. */
  valueCents: Cents | null;
}

export interface HoldingsSnapshot {
  observedAt: Date;
  externalAccountId: string;
  /** P (R1): the total of the whole scope, in the account's currency. */
  totalCents: Cents;
  cashCents: Cents | null;
  positions: SnapshotPosition[];
  scopes: { product: string; complete: boolean }[];
  /** A valid answer with no balance and no position (R5, E7). */
  empty: boolean;
  /** Every product read and every position priced (R5): otherwise the reading is `partial`. */
  complete: boolean;
}

export interface ProviderLeg {
  leg: "main" | "base" | "quote" | "fee";
  kind: "deposit" | "withdrawal" | "buy" | "sell" | "close" | "income" | "fee";
  asset: AssetRef | null;
  product: string | null;
  quantity: string | null;
  unitPrice: string | null;
  priceCurrency: string | null;
  /** Unsigned plain decimal: the kind gives the sign (§1.5). */
  nativeAmount: string;
  nativeCurrency: string;
}

export interface ProviderEvent {
  /** Stable across passes: the idempotency key of the event (A6). */
  externalId: string;
  occurredAt: Date;
  note: string | null;
  legs: ProviderLeg[];
}

export type CoverageStatus = "complete" | "partial" | "gap";

export interface CoverageWindow {
  stream: string;
  fromAt: Date;
  toAt: Date;
  status: CoverageStatus;
  reason: string | null;
}

export interface FlowsRead {
  events: ProviderEvent[];
  coverage: CoverageWindow[];
}

export interface HistoryRead {
  /** One total per day, in the account's currency (§3.3, D10). */
  points: { on: CivilDate; totalCents: Cents }[];
  coverage: CoverageWindow[];
}

export interface InvestmentSource {
  verifyReadOnly(credentials: Readonly<Record<string, string>>): Promise<KeyCheck>;
  fetchHoldings(
    credentials: Readonly<Record<string, string>>,
    currency: string,
    now: Date,
  ): Promise<HoldingsSnapshot>;
  fetchFlows(credentials: Readonly<Record<string, string>>, now: Date): Promise<FlowsRead>;
  fetchHistory(
    credentials: Readonly<Record<string, string>>,
    currency: string,
    now: Date,
  ): Promise<HistoryRead>;
}

/**
 * The classes of failure a source may raise (§5.1, SEC-04). The class, the provider and the HTTP
 * status are all that is ever stored or printed: never the message, the URL, the body, nor a
 * schema's issues.
 */
export const SOURCE_ERROR_CLASSES = [
  "auth",
  "permission",
  "rate_limited",
  "unavailable",
  "timeout",
  "network",
  "bad_response",
  "schema_mismatch",
  "unsupported_currency",
] as const;
export type SourceErrorClass = (typeof SOURCE_ERROR_CLASSES)[number];

export class SourceError extends Error {
  constructor(
    readonly provider: string,
    readonly errorClass: SourceErrorClass,
    readonly status: number | null = null,
    /** What the provider asked for (`Retry-After`, `ratelimit-reset`), in seconds. */
    readonly retryAfterSeconds: number | null = null,
  ) {
    super(`${provider}:${errorClass}`);
    this.name = "SourceError";
  }
}

const PROVIDER_ID = /^[a-z][a-z0-9:_-]{0,39}$/;

/**
 * An error as `sync_runs.error`, `last_error` and the console may carry it (§5.1): built only from
 * the allowlist above, so no other text can pass. Anything that is not a {@link SourceError} is
 * "error", whatever it says.
 */
export function sourceErrorText(provider: string, error: unknown): string {
  const name = PROVIDER_ID.test(provider) ? provider : "provider";
  if (!(error instanceof SourceError) || !SOURCE_ERROR_CLASSES.includes(error.errorClass)) {
    return `${name} · error`;
  }
  const status =
    error.status !== null && Number.isInteger(error.status) && error.status >= 100 && error.status < 600
      ? ` · ${error.status}`
      : "";
  return `${name} · ${error.errorClass}${status}`;
}

/** The reduced form `console.error` receives: the same three facts, never the error itself. */
export function sourceErrorLog(provider: string, error: unknown): { provider: string; error: string } {
  return {
    provider: PROVIDER_ID.test(provider) ? provider : "provider",
    error: sourceErrorText(provider, error),
  };
}

/** A JSON number as a plain decimal string, never in exponent form ("1e-7" → "0.0000001"). */
export function plainNumber(value: number): string {
  if (!Number.isFinite(value)) throw new RangeError("Not a finite number");
  return value.toLocaleString("en-US", { useGrouping: false, maximumFractionDigits: 18 });
}
