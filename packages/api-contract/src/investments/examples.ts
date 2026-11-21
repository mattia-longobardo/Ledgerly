// The examples of the investments' descriptors, checked against their schemas by the gate.
import { ACCOUNT_ID, ASSET_ID, EVENT_ID, HOLDING_ID } from "./shared";

export const PARTS_EXAMPLE = {
  pnl: "650.00",
  realized: "0.00",
  unrealized: "650.00",
  income: "0.00",
  fees: "0.00",
  corrections: "0.00",
  fx: "0.00",
} as const;

export const FULL_PARTS = { ...PARTS_EXAMPLE, unattributed: "0.00", feesAndFx: "0.00", beforeFx: "650.00" };

export const PERIOD_EXAMPLE = {
  kind: "year",
  year: 2026,
  from: "2026-01-01",
  to: "2026-11-21",
  span: { from: "2026-01-01", to: "2026-11-21" },
  firstOn: "2025-03-01",
} as const;

export const TOTALS_EXAMPLE = {
  value: "12650.00",
  valuePartial: false,
  invested: "12000.00",
  gain: "650.00",
  simpleReturn: 0.054167,
  xirr: 0.097847,
  xirrStatus: "ok",
  includesExchangeEffect: false,
} as const;

export const SERVICE_EXAMPLE = {
  accountId: ACCOUNT_ID,
  name: "Directa",
  category: "broker",
  provider: "manual",
  origin: "manual",
  mode: "total",
  currency: "EUR",
  value: "12650.00",
  displayValue: "12650.00",
  change30Days: "2350.00",
  invested: "12000.00",
  gain: "650.00",
  simpleReturn: 0.054167,
  xirr: 0.097847,
  xirrStatus: "ok",
  reliable: true,
  reliableFrom: null,
  weight: 1,
  lastUpdate: null,
} as const;

const WARNINGS = { conflicts: 0, pendingZero: false, missingPrices: 0, openAdjustments: 0, alerts: 0 };

export const LISTED_EXAMPLE = { ...SERVICE_EXAMPLE, color: null, colorIndex: 0, warnings: WARNINGS };

const RETURN_EXAMPLE = {
  modifiedDietz: 0.054167,
  method: "dietz",
  xirr: null,
  xirrStatus: "unavailable",
  largeFlows: false,
} as const;

export const SERVICE_PNL_EXAMPLE = {
  accountId: ACCOUNT_ID,
  status: "verified",
  reasons: [],
  from: "2026-01-01",
  to: "2026-11-21",
  partial: false,
  start: "12000.00",
  end: "12650.00",
  endCash: null,
  openPositions: 1,
  local: FULL_PARTS,
  display: FULL_PARTS,
  localReturn: RETURN_EXAMPLE,
  displayReturn: RETURN_EXAMPLE,
} as const;

export const CHART_EXAMPLE = {
  barGrain: "month",
  intervals: [{ from: "2026-11-01", to: "2026-11-21" }],
  valueGrain: "day",
  valueDays: ["2026-11-21"],
  services: [{ accountId: ACCOUNT_ID, bars: ["650.00"], values: ["12650.00"], returns: [0.054167] }],
  bars: ["650.00"],
  cumulative: ["650.00"],
  values: ["12650.00"],
  returns: [0.054167],
  cumulativeReturns: [0.054167],
} as const;

export const CONTRIBUTIONS_EXAMPLE = {
  rows: [
    {
      key: HOLDING_ID,
      holdingId: HOLDING_ID,
      assetId: ASSET_ID,
      product: "trading",
      pnl: "650.00",
      realized: "0.00",
      unrealized: "650.00",
      open: true,
      sold: false,
      costUnknown: false,
      bar: 1,
    },
  ],
  income: "0.00",
  fees: "0.00",
  corrections: "0.00",
  valueChange: "0.00",
  unattributed: "0.00",
  total: "650.00",
} as const;

export const ASSET_EXAMPLE = {
  id: ASSET_ID,
  name: "Vanguard FTSE All-World",
  class: "etf",
  symbol: "VWCE",
  isin: "IE00BK5BQT80",
  currency: "EUR",
} as const;

export const ACTIVITY_ROW_EXAMPLE = {
  id: EVENT_ID,
  on: "2026-11-03",
  origin: "manual",
  note: null,
  family: "trades",
  leg: {
    kind: "sell",
    holdingId: HOLDING_ID,
    assetName: "Vanguard FTSE All-World",
    assetClass: "etf",
    product: "trading",
    quantity: "2",
    unitPrice: "130.5",
    priceCurrency: "EUR",
    amount: "261.00",
    validUntil: null,
  },
  adjustmentClass: null,
  transactionId: null,
  linked: null,
  transfer: null,
  realized: "21.00",
} as const;

export const PROVIDER_EXAMPLE = {
  id: "ccxt:binance",
  name: "Binance",
  category: "crypto",
  accountType: "crypto",
  credentialFields: ["api_key", "secret"],
  currencies: ["EUR", "USD"],
  defaultCurrency: "EUR",
  ipWhitelist: "supported",
  url: "https://www.binance.com",
  revokeUrl: "https://www.binance.com/en/my/settings/api-management",
} as const;
