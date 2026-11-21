// The vocabulary of the Investments engine (docs/design/investments.md §1, §2) and its fixed-point decimals.
import type { Cents } from "../../../shared/money";
import { divRound } from "../../../shared/money";

// ——— Vocabulary ——————————————————————————————————————————————————————————————————————————————

export const INVESTMENT_CATEGORIES = ["accounts", "broker", "crypto"] as const;
export type InvestmentCategory = (typeof INVESTMENT_CATEGORIES)[number];

export const MODES = ["assets", "total"] as const;
export type Mode = (typeof MODES)[number];

/**
 * The one mode of a manual service (PERS-335): deposits, withdrawals and the value the person reads
 * from the broker — no positions. `assets` stays for the synced services and for old periods.
 */
export const MANUAL_MODE = "total" satisfies Mode;

export const ORIGINS = ["manual", "synced"] as const;
export type AccountOrigin = (typeof ORIGINS)[number];

export const PERIOD_REASONS = ["opening", "migration", "handover", "conversion"] as const;

export const ASSET_CLASSES = [
  "stock",
  "etf",
  "fund",
  "bond",
  "crypto",
  "stablecoin",
  "cash",
  "other",
] as const;
export type AssetClass = (typeof ASSET_CLASSES)[number];

export const PRICE_SOURCES = ["manual", "provider", "market"] as const;

export const HOLDING_ORIGINS = ["manual", "provider"] as const;
export type HoldingOrigin = (typeof HOLDING_ORIGINS)[number];

/** `other:<label>` is the escape hatch for a sub-account the list does not name (A1). */
export const PRODUCTS = ["spot", "funding", "earn", "staking", "custody"] as const;
/** The products of eToro's scope (D17 · E2, E3): one per account type, and the copies. */
export const BROKER_PRODUCTS = ["trading", "cash", "crypto", "copy"] as const;
export const PRODUCT_PATTERN =
  "^(spot|funding|earn|staking|custody|trading|cash|crypto|copy|other:[a-z0-9_-]{1,30})$";

export const EVENT_ORIGINS = ["manual", "provider", "conversion"] as const;
export type EventOrigin = (typeof EVENT_ORIGINS)[number];

export const LEGS = ["main", "base", "quote", "fee"] as const;
export type Leg = (typeof LEGS)[number];

export const OPERATION_KINDS = [
  "opening_cash",
  "opening_position",
  "deposit",
  "withdrawal",
  "buy",
  "sell",
  "valuation",
  "close",
  "income",
  "fee",
  "account_valuation",
  "adjustment",
] as const;
export type OperationKind = (typeof OPERATION_KINDS)[number];

/** The kinds whose `amount_cents` has one sign (§1.5): money in is positive, money out negative. */
export const POSITIVE_KINDS = ["deposit", "sell", "close", "income"] as const;
export const NEGATIVE_KINDS = ["withdrawal", "buy", "fee"] as const;

/** What a correction (R3) stands for (docs/design/investments-ux.md §4.9): `data` by default. */
export const ADJUSTMENT_CLASSES = ["data", "capital", "result"] as const;
export type AdjustmentClass = (typeof ADJUSTMENT_CLASSES)[number];

export const QUANTITY_BASES = ["reported", "reconstructed", "inferred"] as const;

/**
 * `reconstructed` (PERS-100, PERS-145): a day before the first reading of a service whose provider
 * has no history of its value, rebuilt from the complete flows of its 12 months and the exchange's
 * daily closes. A datum like any reading, not an estimate.
 */
export const READING_STATUSES = [
  "complete",
  "partial",
  "confirmed_zero",
  "pending_zero",
  "reconstructed",
] as const;
export type ReadingStatus = (typeof READING_STATUSES)[number];

export const RECONCILIATION_KINDS = ["covered_by_provider", "outside_scope", "partial", "reopened"] as const;
export type ReconciliationKind = (typeof RECONCILIATION_KINDS)[number];

/** §1.2: what a key check can conclude; `error` is a check the provider did not answer. */
export const KEY_CHECK_RESULTS = ["read-only", "write", "unknown-flag", "unverifiable", "error"] as const;
/** Why a check ran: the connection, a replacement of the key, a pass, or "Verify". */
export const KEY_CHECK_ORIGINS = ["connect", "replace", "pass", "verify"] as const;
export type KeyCheckOrigin = (typeof KEY_CHECK_ORIGINS)[number];
export const COVERAGE_STATUSES = ["complete", "partial", "gap"] as const;

// ——— Fixed-point decimals ————————————————————————————————————————————————————————————————————

/** `numeric(38,18)`: a quantity in units of 10⁻¹⁸ (wei, satoshi and below, V8). */
export const QUANTITY_SCALE = 18;
/** `numeric(30,12)`: a unit price in units of 10⁻¹². */
export const PRICE_SCALE = 12;
/** `numeric(20,10)`: a rate in units of 10⁻¹⁰, as `fx_rates`. */
export const RATE_SCALE = 10;

/** Quantity × unit price, in cents of the price's currency. */
export function positionCents(quantity: bigint, unitPrice: bigint): Cents {
  return divRound(quantity * unitPrice, 10n ** BigInt(QUANTITY_SCALE + PRICE_SCALE - 2));
}

/** Cents of one currency at a stored rate (units of the target per unit of the source). */
export function atRate(cents: Cents, rate: bigint): Cents {
  return divRound(cents * rate, 10n ** BigInt(RATE_SCALE));
}

/** The unit price that makes `quantity` cost `cents` (for an amount typed as a total). */
export function unitPriceOf(cents: Cents, quantity: bigint): bigint {
  return divRound(cents * 10n ** BigInt(QUANTITY_SCALE + PRICE_SCALE - 2), quantity);
}
