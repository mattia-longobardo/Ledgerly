/**
 * The contract every investment provider implements (docs/design/investments.md §3.1): read only,
 * no database, no `server-only`, so the mapping is testable on the fixtures of the spike. The
 * module `investments` owns the pass that calls it, the lock, the transactions and the engine.
 *
 * Amounts leave a source as plain decimal strings in the currency they are in (`nativeAmount`,
 * `nativeCurrency`), or as cents already in the account's currency where the provider converted
 * them itself (eToro's `displayCurrency`). The pass converts the rest at the ECB rate of the day,
 * unless the source priced the leg itself (`fxRate`, an exchange's own market, §1.8).
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
  /** What the position cost, in the account's currency, when the provider says it (eToro, U4). */
  costCents?: Cents | null;
  /** When the price was quoted (a ticker's timestamp); the reading's time when absent. */
  priceAt?: Date | null;
  /** Account units per unit of `priceCurrency`, and where that came from (A5). */
  fxRate?: string | null;
  fxSource?: string | null;
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
  /**
   * Account units per unit of `nativeCurrency`, when the source priced the leg itself (a coin at
   * the exchange's daily close, §1.8), with where it came from. `fxSource` without `fxRate`: no
   * market priced it, so the leg counts its quantity and no amount.
   */
  fxRate?: string | null;
  fxSource?: string | null;
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

/** Where each stream of flows stopped (A7): opaque to the module, saved with the events it read. */
export type FlowCursor = Record<string, string>;

export interface FlowsRead {
  events: ProviderEvent[];
  coverage: CoverageWindow[];
  /** The cursor to resume from; absent for a source that reads its whole history every pass. */
  cursor?: FlowCursor;
  /**
   * The first moment of the history the source reads (24 months for ccxt, D11), for a source whose
   * quantities the module checks (A6): opening positions are inferred there.
   */
  historyFrom?: Date;
  /**
   * Account units per unit of each coin held, on the day of `historyFrom`: the value of the opening
   * positions the module infers there (A6, §2.4). Only on the pass that starts the history.
   */
  openingRates?: Record<string, { rate: string; source: string }>;
  /**
   * The source now reads streams or markets it did not read when the history started (PERS-141):
   * the openings inferred then absorbed what it missed, so the module infers them again from
   * `openingRates` and estimates the history again. Once per change of what the source reads.
   */
  rebase?: boolean;
}

/** Account units per unit of `from` on a day, from the ECB rates the module keeps (§1.8). */
export type FxLookup = (from: string, to: string, on: CivilDate) => string | null;

export interface FlowsOptions {
  /** The account's currency. */
  currency: string;
  cursor: FlowCursor | null;
  fx: FxLookup;
  /**
   * The first day the service keeps (PERS-145): its cut-off, once it has one. Inside it the data
   * are complete; a source that marks an earlier stretch as partial ends it here, never later.
   */
  since?: Date;
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
    fx?: FxLookup,
  ): Promise<HoldingsSnapshot>;
  fetchFlows(
    credentials: Readonly<Record<string, string>>,
    now: Date,
    options?: FlowsOptions,
  ): Promise<FlowsRead>;
  fetchHistory(
    credentials: Readonly<Record<string, string>>,
    currency: string,
    now: Date,
  ): Promise<HistoryRead>;
  /**
   * For a provider with no history of the account's value (PERS-100, Binance): each coin's rate in
   * the account's currency on every day from `from` to `now`, at the exchange's daily close (§1.8).
   * Plain decimals by coin and day; a day no market priced is absent. The module rebuilds the
   * history from these and the flows.
   */
  fetchDailyRates?(
    credentials: Readonly<Record<string, string>>,
    coins: readonly string[],
    currency: string,
    from: Date,
    now: Date,
    fx: FxLookup,
  ): Promise<Record<string, Record<CivilDate, string>>>;
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
