// What the descriptors of investments share (rewrite plan R2, 05-refactor.md §5.5 «investments»): the
// vocabularies of the wire, the ids of the examples and the answers of `GET /investments` and
// `GET /investments/{accountId}/holdings` as `apps/api/src/investments/dto.ts` writes them today
// (baselines/contract/api.json). No route is declared here. Amounts are decimal strings; a
// return or a weight is a ratio rounded to 6 decimals (0.05 is 5 %).
import { z } from "zod";
import { civilDate, id, money } from "../primitives";

// The vocabularies are the domain's (`@ledgerly/domain/investments`, `rules.ts`, `activity.ts`): the
// contract imports zod only (10-modularity.md §10.2), so `tools/contract.test.ts` holds them equal.
export const INVESTMENT_CATEGORIES = ["accounts", "broker", "crypto"] as const;
export const MODES = ["assets", "total"] as const;
export const ORIGINS = ["manual", "synced"] as const;
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
export const HOLDING_ORIGINS = ["manual", "provider"] as const;
export const EVENT_ORIGINS = ["manual", "provider", "conversion"] as const;
export const PERIOD_REASONS = ["opening", "migration", "handover", "conversion"] as const;
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
export const ADJUSTMENT_CLASSES = ["data", "capital", "result"] as const;
export const RECONCILIATION_KINDS = ["covered_by_provider", "outside_scope", "partial", "reopened"] as const;
export const READING_STATUSES = [
  "complete",
  "partial",
  "confirmed_zero",
  "pending_zero",
  "reconstructed",
] as const;
export const KEY_CHECK_RESULTS = ["read-only", "write", "unknown-flag", "unverifiable", "error"] as const;
export const COVERAGE_STATUSES = ["complete", "partial", "gap"] as const;
export const ACTIVITY_FAMILIES = ["trades", "flows", "income", "fees", "other"] as const;
/** A product: the list's, or `other:<label>` (A1). */
export const PRODUCT_PATTERN =
  "^(spot|funding|earn|staking|custody|trading|cash|crypto|copy|other:[a-z0-9_-]{1,30})$";
/** `integration_connections.state` (`@ledgerly/domain/platform/integrations`). */
export const CONNECTION_STATES = ["active", "error", "revoked"] as const;

// Wire-only vocabularies: the domain names them as types, with no list to hold them equal to.
/** Why XIRR is missing: no value or no complete history, or no single solution. */
export const XIRR_STATUSES = ["ok", "no_solution", "multiple_solutions", "unavailable"] as const;
export const PNL_STATUSES = ["verified", "stale", "undetermined"] as const;
export const PNL_REASONS = ["stale_price", "flows_gap", "base_unknown", "no_value", "no_rate"] as const;
export const PERIOD_KINDS = ["year", "all", "custom"] as const;
/**
 * Why an account cannot hold a service: a fund's, not investment or crypto, already a service; or,
 * for a manual portfolio only, an account a source reads (R5d).
 */
export const ELIGIBILITY_REASONS = ["fund", "type", "managed", "synced"] as const;
/**
 * Where an asset's price comes from (R5d): `auto`, the daily close of its market; `manual`, the
 * valuations the person types; `provider`, the reading of a synced service.
 */
export const PRICE_MODES = ["auto", "manual", "provider"] as const;

/**
 * The `reason` of a refusal (`InvestmentError`, `SyncError`). `invalid`: `future_date`,
 * `before_period`, `invalid_transaction`, `unknown_provider`, `invalid_credentials`,
 * `unsupported_currency`. Every other one is `conflict`. A missing service, holding, event or reading
 * is `not_found`, with no reason.
 */
export const INVESTMENT_REFUSALS = [
  "future_date",
  "not_eligible",
  "wrong_mode",
  "negative_cash",
  "no_value",
  "duplicate_asset",
  "duplicate_holding",
  "invalid_transaction",
  "already_linked",
  "not_editable",
  "before_period",
  "not_a_transfer",
  "quantity_exceeded",
  "unknown_provider",
  "invalid_credentials",
  "not_read_only",
  "provider_auth",
  "provider_unavailable",
  "rate_limited",
  "unsupported_currency",
  "already_connected",
  "not_connected",
  "cooldown",
  "different_account",
] as const;
export const INVESTMENT_ERRORS = ["invalid", "not_found", "conflict"] as const;

export const ACCOUNT_ID = "c5d6e7f8-0912-4a3b-8c4d-d6e7f8091a2b";
export const OTHER_ACCOUNT_ID = "2b3c4d5e-6f70-4182-b394-3c4d5e6f7081";
export const HOLDING_ID = "d6e7f809-1a2b-4c3d-9e4f-e7f8091a2b3c";
export const EVENT_ID = "e7f8091a-2b3c-4d4e-af50-f8091a2b3c4d";
export const DEPOSIT_ID = "1a2b3c4d-5e6f-4071-a283-2b3c4d5e6f70";
export const READING_ID = "f8091a2b-3c4d-4e5f-8061-091a2b3c4d5e";
export const ASSET_ID = "091a2b3c-4d5e-4f60-9172-1a2b3c4d5e6f";
export const TRANSACTION_ID = "3c4d5e6f-7081-4293-84a5-4d5e6f708192";
export const INSTRUMENT_ID = "4d5e6f70-8192-43a4-95b6-5e6f708192a3";

export const byService = z.object({ accountId: id() });

const ratio = () => z.number().nullable();
const xirrStatus = z.enum(XIRR_STATUSES);

/** A service as `list_investments` lists it: its value today in its currency and in the display one. */
export const serviceRow = z.object({
  /** The row's kind in the one list of Investments (R5b): `PORTFOLIO_KINDS` less `pension_fund`. */
  kind: z.enum(["service", "manual_portfolio"]),
  accountId: id(),
  name: z.string(),
  category: z.enum(INVESTMENT_CATEGORIES),
  /** `manual`, or the provider's id (`etoro`, `ccxt:binance`). */
  provider: z.string(),
  origin: z.enum(ORIGINS).nullable(),
  mode: z.enum(MODES).nullable(),
  currency: z.string(),
  value: money().nullable(),
  displayValue: money().nullable(),
  change30Days: money().nullable(),
  invested: money().nullable(),
  /** Null unless the history is complete (`reliable`). */
  gain: money().nullable(),
  simpleReturn: ratio(),
  xirr: ratio(),
  xirrStatus,
  reliable: z.boolean(),
  reliableFrom: civilDate().nullable(),
  /** Share of the portfolio's value in the display currency. */
  weight: ratio(),
  lastUpdate: civilDate().nullable(),
});

/** The portfolio's totals today, in the display currency. */
export const portfolioTotals = z.object({
  value: money().nullable(),
  valuePartial: z.boolean(),
  invested: money().nullable(),
  gain: money().nullable(),
  simpleReturn: ratio(),
  xirr: ratio(),
  xirrStatus,
  includesExchangeEffect: z.boolean(),
});

/** The additive parts of a P&L: their sum is `pnl`. `unrealized` is null where a day's positions are unknown. */
export const legacyParts = z.object({
  pnl: money(),
  realized: money(),
  unrealized: money().nullable(),
  income: money(),
  fees: money(),
  corrections: money(),
  fx: money(),
});

/** The parts as the legacy answer spreads them: all present, or all absent when undetermined. */
const spreadParts = legacyParts.partial();

/** Modified Dietz of the period in the display currency (D9); null without capital to divide by. */
export const modifiedDietz = ratio();

/** The P&L of the period, as `GET /investments` answers it in `pnl`, plus `modifiedDietz` (D9). */
const legacyPnl = z.object({
  period: z.object({ kind: z.enum(PERIOD_KINDS), from: civilDate().nullable(), to: civilDate() }),
  currency: z.string(),
  status: z.enum(PNL_STATUSES),
  ...spreadParts.shape,
  transfers: money(),
  services: z.array(
    z.object({
      accountId: id(),
      status: z.enum(PNL_STATUSES),
      from: civilDate().nullable(),
      to: civilDate(),
      openPositions: z.number().int(),
      display: legacyParts.nullable(),
      local: z.object({ currency: z.string(), ...spreadParts.shape }),
      modifiedDietz,
    }),
  ),
  modifiedDietz,
});

/** `GET /investments` and `list_investments`: today's portfolio and the P&L of the period. */
export const investmentsList = z.object({
  on: civilDate(),
  currency: z.string(),
  totals: portfolioTotals,
  services: z.array(serviceRow),
  pnl: legacyPnl,
});

/**
 * The price of an asset (R5d): where it comes from, the day of the last one and its source
 * (`yahoo`, `manual`, the provider's id). `stale`: the last price is older than 5 working days, the
 * asset is «to update».
 */
export const assetPrice = z.object({
  mode: z.enum(PRICE_MODES),
  on: civilDate().nullable(),
  source: z.string().nullable(),
  stale: z.boolean(),
});

/** An asset as a row names it. */
export const assetRef = z.object({
  name: z.string(),
  class: z.enum(ASSET_CLASSES),
  symbol: z.string().nullable(),
  isin: z.string().nullable(),
  currency: z.string(),
  /** The instrument of the registry and the market of the order (R5d); null for an asset outside it. */
  instrumentId: id().nullable(),
  mic: z.string().nullable(),
  price: assetPrice,
});

/** `GET /investments/{accountId}/holdings` and `get_investment_holdings`: the open positions today. */
export const holdingsList = z.object({
  accountId: id(),
  name: z.string(),
  currency: z.string(),
  on: civilDate(),
  holdings: z.array(
    z.object({
      asset: assetRef,
      product: z.string(),
      origin: z.enum(HOLDING_ORIGINS),
      /** Plain decimals; null for a position kept by value only. */
      quantity: z.string().nullable(),
      unitPrice: z.string().nullable(),
      priceCurrency: z.string().nullable(),
      pricedOn: civilDate().nullable(),
      value: money().nullable(),
      gain: money().nullable(),
      weight: ratio(),
      conflict: z.boolean(),
    }),
  ),
});
