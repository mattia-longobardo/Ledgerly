// The reads of investments (rewrite plan R2, 05-refactor.md §5.5 «investments»; docs/design/
// investments.md §5.5, SEC-08): `GET /investments` and the holdings of a service exactly as the
// legacy routes and MCP tools answer them, then one read per page. Scope `investments:read`, which
// `read` does not imply; the Connection tab is the session's only: a token never sees a key check,
// a last error or the provider's readings.
import { z } from "zod";
import { civilDate, id } from "../primitives";
import { defineRoute } from "../route";
import { periodQuery } from "../funds/shared";
import {
  ACTIVITY_ROW_EXAMPLE,
  ASSET_EXAMPLE,
  CHART_EXAMPLE,
  CONTRIBUTIONS_EXAMPLE,
  LISTED_EXAMPLE,
  FULL_PARTS,
  PARTS_EXAMPLE,
  PERIOD_EXAMPLE,
  PROVIDER_EXAMPLE,
  SERVICE_EXAMPLE,
  SERVICE_PNL_EXAMPLE,
  TOTALS_EXAMPLE,
} from "./examples";
import { ACCOUNT_ID, ACTIVITY_FAMILIES, byService, holdingsList, investmentsList } from "./shared";
import { investmentActivity, investmentOverview, investmentsCatalog, investmentsHome } from "./views";
import { investmentConnection, investmentPositions } from "./tabs";
import { FUND_ID, PORTFOLIO_EXAMPLE, portfolioParts } from "./portfolio";

const civilDateArgument = civilDate("A date as YYYY-MM-DD");
const accountArgument = z.uuid().describe("The service's accountId, from list_investments.");

/**
 * The legacy route's query: a value it cannot read is the year running, never a 400 (F8). `include`
 * = `funds` adds the pension funds' rows, the two groups and the one total (R5b); any other value,
 * or none, keeps the answer of before.
 */
const legacyQuery = z.object({
  period: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  include: z.string().optional(),
});

export const listInvestments = defineRoute({
  id: "list_investments",
  method: "GET",
  path: "/investments",
  scope: "investments:read",
  capability: "investments",
  summary:
    "Every investment service with its value today, net invested, gain, simple return and XIRR, the " +
    "portfolio's totals in the display currency, and `pnl`, the profit and loss of the period with its " +
    "Modified Dietz return.",
  actions: [],
  query: legacyQuery,
  response: investmentsList.extend({
    /** With `include=funds` only: the total Overview's «Investments» shows. */
    total: portfolioParts.total.optional(),
    /** With `include=funds` only: «Azioni e crypto» and «Fondi pensione», each with its rows. */
    groups: portfolioParts.groups.optional(),
  }),
  errors: [],
  mcp: {
    title: "Investments",
    description:
      "Every investment service (broker, exchange, manual account) with its value in its own " +
      "`currency` and in the display currency, net invested, gain, simple return and XIRR, plus the " +
      "portfolio's totals in the display `currency`, as GET /api/v1/investments. Returns are ratios " +
      "(0.05 = 5 %). Gain and returns are null unless the service's history is complete " +
      "(`reliable`; `reliableFrom` says from when it is); `xirrStatus` says why XIRR is missing. " +
      "The portfolio leaves out transfers between its own services and includes the exchange effect. " +
      "`pnl` is the profit and loss of the period (the year running by default), the number the " +
      "screen shows: realized, unrealized (open positions only), income, fees, corrections and " +
      "exchange effect add up to it, and the services add up to the portfolio with `transfers`. Each " +
      "service has a `kind`: `service` (a provider or a bank reads it) or `manual_portfolio`. With " +
      "`include` = `funds` the answer adds `total` and `groups`: the pension funds too, the two groups " +
      "«stocks_crypto» and «pension_funds» with their rows, and for each the value today, the money " +
      "put in, the gain and the return of the period; `total.value` is the net worth's investments.",
    arguments: {
      period: z
        .string()
        .regex(/^(\d{4}|all)$/)
        .optional()
        .describe("A year (YYYY) or `all`; default the year running."),
      from: civilDateArgument.optional().describe("First day, YYYY-MM-DD; with `to`, wins over `period`."),
      to: civilDateArgument.optional().describe("Last day, YYYY-MM-DD."),
      include: z
        .enum(["funds"])
        .optional()
        .describe("`funds`: add the pension funds, the two groups and the one total."),
    },
  },
  example: {
    query: { period: "2026" },
    response: {
      on: "2026-11-21",
      currency: "EUR",
      totals: TOTALS_EXAMPLE,
      services: [SERVICE_EXAMPLE],
      pnl: {
        period: { kind: "year", from: "2026-01-01", to: "2026-11-21" },
        currency: "EUR",
        status: "verified",
        ...PARTS_EXAMPLE,
        transfers: "0.00",
        services: [
          {
            accountId: ACCOUNT_ID,
            status: "verified",
            from: "2026-01-01",
            to: "2026-11-21",
            openPositions: 1,
            display: PARTS_EXAMPLE,
            local: { currency: "EUR", ...PARTS_EXAMPLE },
            modifiedDietz: 0.054167,
          },
        ],
        modifiedDietz: 0.054167,
      },
    },
  },
});

export const getInvestmentHoldings = defineRoute({
  id: "get_investment_holdings",
  method: "GET",
  path: "/investments/{accountId}/holdings",
  scope: "investments:read",
  capability: "investments",
  summary: "The open positions of one service today, in the service's currency.",
  actions: [],
  params: byService,
  response: holdingsList,
  errors: ["invalid", "not_found"],
  mcp: {
    title: "Investment holdings",
    description:
      "The open positions of one investment service today — asset, product, quantity, price, value " +
      "and gain in the service's `currency` — as GET /api/v1/investments/{accountId}/holdings. Take " +
      "the account id from list_investments.",
    arguments: { account_id: accountArgument },
    pathArguments: { accountId: "account_id" },
  },
  example: {
    params: { accountId: ACCOUNT_ID },
    response: { accountId: ACCOUNT_ID, name: "Directa", currency: "EUR", on: "2026-11-21", holdings: [] },
  },
});

export const getInvestmentsHome = defineRoute({
  id: "get_investments_home",
  method: "GET",
  path: "/investments/home",
  scope: "investments:read",
  capability: "investments",
  summary:
    "The home of a period: today's totals and allocation by class, service and currency, the pension " +
    "funds, each service with its P&L of the period, contribution and alerts, the parts and the charts.",
  actions: [],
  query: periodQuery,
  response: investmentsHome,
  errors: ["invalid"],
  example: {
    query: { period: "2026" },
    response: {
      on: "2026-11-21",
      currency: "EUR",
      period: PERIOD_EXAMPLE,
      totals: TOTALS_EXAMPLE,
      valueAtEnd: null,
      services: [
        {
          ...LISTED_EXAMPLE,
          pnl: SERVICE_PNL_EXAMPLE,
          contribution: { pnl: "650.00", bar: 1, shareOfNet: 1 },
        },
      ],
      pnl: {
        status: "verified",
        available: false,
        parts: FULL_PARTS,
        transfers: "0.00",
        openPositions: 1,
        modifiedDietz: 0.054167,
        rateReason: "ok",
        partial: [],
        stale: [],
        excluded: [],
      },
      chart: CHART_EXAMPLE,
      byClass: [{ key: "unclassified", value: "12650.00", share: 1 }],
      byService: [{ key: ACCOUNT_ID, value: "12650.00", share: 1 }],
      byCurrency: [{ key: "EUR", value: "12650.00", share: 1 }],
      funds: { total: "12450.00", rows: [{ id: FUND_ID, name: "Fondo Pensione", value: "12450.00" }] },
      ...PORTFOLIO_EXAMPLE,
    },
  },
});

export const getInvestment = defineRoute({
  id: "get_investment",
  method: "GET",
  path: "/investments/{accountId}",
  scope: "investments:read",
  capability: "investments",
  summary:
    "A service's Overview in a period, with what its header and dialogs need: the service today, its P&L " +
    "of the period with the Modified Dietz return, the chart, what each position added, the latest events.",
  actions: [],
  params: byService,
  query: periodQuery,
  response: investmentOverview,
  errors: ["invalid", "not_found"],
  mcp: {
    title: "Investment service",
    description:
      "One investment service by account id (from list_investments) in a period (default: the year " +
      "running; `period` = all, a year, or custom with `from` and `to`): its value today, its profit " +
      "and loss of the period in its own and in the display currency with the parts that add up to it " +
      "and the Modified Dietz return, what each position added, and its latest events. Amounts are " +
      "decimal strings, returns are ratios.",
    arguments: {
      account_id: accountArgument,
      period: periodQuery.shape.period,
      from: periodQuery.shape.from,
      to: periodQuery.shape.to,
    },
    pathArguments: { accountId: "account_id" },
  },
  example: {
    params: { accountId: ACCOUNT_ID },
    query: { period: "2026" },
    response: {
      on: "2026-11-21",
      currency: "EUR",
      period: PERIOD_EXAMPLE,
      service: {
        ...LISTED_EXAMPLE,
        accountOrigin: "manual",
        url: "https://www.directa.it",
        managedSince: "2025-03-01",
        firstOn: "2025-03-01",
        valueEditable: true,
        manualPnl: {
          value: "12650.00",
          invested: "12000.00",
          pnl: "650.00",
          rate: 0.054167,
          valuedOn: "2026-11-20",
          stale: false,
          staleDays: 30,
        },
        sync: null,
        provider: null,
        assets: [ASSET_EXAMPLE],
        coveredProducts: [],
        linkOptions: { out: [], in: [] },
      },
      pnl: SERVICE_PNL_EXAMPLE,
      chart: { ...CHART_EXAMPLE, markers: [null] },
      contributions: CONTRIBUTIONS_EXAMPLE,
      recent: [ACTIVITY_ROW_EXAMPLE],
    },
  },
});

export const getInvestmentActivity = defineRoute({
  id: "get_investment_activity",
  method: "GET",
  path: "/investments/{accountId}/activity",
  scope: "investments:read",
  capability: "investments",
  summary:
    "A service's Activity in a period: fifty events a page, newest first, filtered by family, text or " +
    "asset, with the counts, the months, the money in and out and the transfers to link; for a manual " +
    "service, the bank movements of its account.",
  actions: [],
  params: byService,
  query: periodQuery.extend({
    family: z.enum(ACTIVITY_FAMILIES).optional(),
    /** Searched in the asset's name and symbol and in the note. */
    q: z.string().max(100).optional(),
    assetId: id().optional(),
    page: z.coerce.number().int().min(1).optional(),
  }),
  response: investmentActivity,
  errors: ["invalid", "not_found"],
  example: {
    params: { accountId: ACCOUNT_ID },
    query: { period: "2026", family: "trades" },
    response: {
      source: "events",
      period: PERIOD_EXAMPLE,
      page: 1,
      pages: 1,
      total: 1,
      allTime: 12,
      counts: { trades: 1, flows: 0, income: 0, fees: 0, other: 0, all: 1 },
      months: [{ month: "2026-11", count: 1, realized: "21.00" }],
      sums: { deposits: "0.00", withdrawals: "0.00", fees: "0.00", net: "0.00" },
      first: 1,
      last: 1,
      rows: [ACTIVITY_ROW_EXAMPLE],
      transferProposals: [],
    },
  },
});

export const getInvestmentPositions = defineRoute({
  id: "get_investment_positions",
  method: "GET",
  path: "/investments/{accountId}/positions",
  scope: "investments:read",
  capability: "investments",
  summary:
    "A synced service's Positions in a period: open on its last day with what each added, closed in it " +
    "and ever, and the contributions that close on the Overview's P&L.",
  actions: [],
  params: byService,
  query: periodQuery,
  response: investmentPositions,
  errors: ["invalid", "not_found"],
  example: {
    params: { accountId: ACCOUNT_ID },
    query: { period: "2026" },
    response: {
      on: "2026-11-21",
      period: PERIOD_EXAMPLE,
      currency: "EUR",
      displayCurrency: "EUR",
      status: "verified",
      display: { pnl: "650.00", fx: "0.00" },
      startOn: "2025-12-31",
      open: { rows: [], cash: null, total: "0.00", pnl: "0.00", cashShare: null, noCost: 0, byClass: [] },
      closedInPeriod: { groups: [], realized: "0.00" },
      closedEver: { groups: [], realized: "0.00" },
      contributions: CONTRIBUTIONS_EXAMPLE,
      dust: [],
      assets: [ASSET_EXAMPLE],
      latestReading: null,
    },
  },
});

export const getInvestmentConnection = defineRoute({
  id: "get_investment_connection",
  method: "GET",
  path: "/investments/{accountId}/connection",
  scope: "session",
  capability: "investments",
  summary:
    "A service's Connection (Settings for a manual one), today: what the provider gives, the readings, " +
    "the corrections, the key's checks and the settings. The session's only (SEC-08); never a credential.",
  actions: [],
  params: byService,
  response: investmentConnection,
  errors: ["invalid", "not_found"],
  example: {
    params: { accountId: ACCOUNT_ID },
    response: {
      on: "2026-11-21",
      accountId: ACCOUNT_ID,
      name: "Directa",
      currency: "EUR",
      warnings: { conflicts: 0, pendingZero: false, missingPrices: 0, openAdjustments: 0, alerts: 0 },
      provider: null,
      sync: null,
      readings: [],
      reconstructedReadings: null,
      firstReadOn: null,
      adjustments: [],
      settings: { mode: "total", managedSince: "2025-03-01", url: null, periods: [] },
    },
  },
});

export const getInvestmentsCatalog = defineRoute({
  id: "get_investments_catalog",
  method: "GET",
  path: "/investments/catalog",
  scope: "investments:read",
  capability: "investments",
  summary:
    "The providers a service can be added from, with the accounts each is connected to (no entry " +
    "`planned` since R5b: the value stays in the schema until R5f), and the investment and crypto accounts a " +
    "service can use, with why one cannot.",
  actions: [],
  response: investmentsCatalog,
  errors: [],
  example: {
    response: {
      providers: [{ ...PROVIDER_EXAMPLE, connect: "apikey", status: "available", connected: [] }],
      existing: [
        {
          id: ACCOUNT_ID,
          name: "Directa",
          currency: "EUR",
          type: "investment",
          balance: "12650.00",
          reason: "managed",
          synced: false,
          manualService: true,
        },
      ],
    },
  },
});
