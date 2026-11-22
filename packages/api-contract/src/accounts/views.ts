// Accounts · the reads of the views (rewrite plan R2, 05-refactor.md §5.5; orchestrator's scope of
// the step): what Overview, the list of accounts and an account's page draw, from the same total
// as `GET /summary` and the snapshot (ACC-1, ACC-3/D2). Every total is in the display currency;
// an account's own fields are in its currency.
import { z } from "zod";
import { defineRoute } from "../route";
import { civilDate, id, instant, money, monthStart } from "../primitives";
import { ACCOUNT_ID, ACCOUNT_ORIGINS, ACCOUNT_STATES, ACCOUNT_TYPES, byAccount, delta } from "./shared";
import { PORTFOLIO_GROUPS } from "../investments/portfolio";

/** The longest window of the views: ten years of month ends, three of days. */
const MAX_MONTHS = 120;
const MAX_DAYS = 1100;

const BUCKETS = ["cash", "savings", "investments", "other"] as const;
const bucketTotal = z.object({ total: money().nullable(), partial: z.boolean(), count: z.number().int() });

const viewRow = z.object({
  id: id(),
  name: z.string(),
  type: z.enum(ACCOUNT_TYPES),
  currency: z.string(),
  origin: z.enum(ACCOUNT_ORIGINS),
  state: z.enum(ACCOUNT_STATES),
  color: z.string().nullable(),
  inNetWorth: z.boolean(),
  countsAsLiquid: z.boolean(),
  bucket: z.enum(BUCKETS),
  /** The latest reading on or before today, in the account's currency. */
  balance: money().nullable(),
  /** At the end of the previous month, for the monthly change. */
  previous: money().nullable(),
  /** One month end per month of `months`; the account's `betweenEntries` applies here only. */
  series: z.array(money().nullable()),
  /** Per month, whether the value stands on a month end rebuilt from the movements. */
  estimated: z.array(z.boolean()),
  /** Each month end of `series` from the one before; the first has none (amount and fraction null). */
  seriesChange: z.array(delta),
  /** The same months held, never interpolated: what the net worth sums. */
  held: z.array(money().nullable()),
  /** The same figures in the display currency, each at the rate of its day; null without a rate. */
  display: z.object({
    balance: money().nullable(),
    previous: money().nullable(),
    held: z.array(money().nullable()),
  }),
  missingRate: z.boolean(),
  stale: z.boolean(),
  /** `balance` from `previous`, in the account's currency. */
  change: delta,
  /** `balance` from the same month a year before (the 13th month end back); null with fewer months. */
  yoy: delta,
  /** `display.balance` as a fraction of `total`; null for an archived account, outside the total. */
  share: z.number().nullable(),
  lastSyncedAt: instant().nullable(),
  /** The service of Investments a provider feeds, and its last reading: what «Last synced» shows first. */
  service: z.object({ provider: z.string(), lastSyncedAt: instant().nullable() }).nullable(),
  /**
   * The group of Investments the account is in (R5b, decision O1): `pension_funds` for a fund's
   * account, `stocks_crypto` for the other accounts of the «investments» bucket; null outside it.
   */
  investmentGroup: z.enum(PORTFOLIO_GROUPS).nullable(),
});

const VIEW_ROW_EXAMPLE = {
  id: ACCOUNT_ID,
  name: "Everyday account",
  type: "checking",
  currency: "EUR",
  origin: "manual",
  state: "active",
  color: null,
  inNetWorth: true,
  countsAsLiquid: true,
  bucket: "cash",
  balance: "11302.40",
  previous: "11545.84",
  series: ["11545.84", "11302.40"],
  estimated: [false, false],
  seriesChange: [
    { amount: null, fraction: null },
    { amount: "-243.44", fraction: -0.0210849 },
  ],
  held: ["11545.84", "11302.40"],
  display: { balance: "11302.40", previous: "11545.84", held: ["11545.84", "11302.40"] },
  missingRate: false,
  stale: false,
  change: { amount: "-243.44", fraction: -0.0210849 },
  yoy: { amount: null, fraction: null },
  share: 1,
  lastSyncedAt: null,
  service: null,
  investmentGroup: null,
};

export const getNetWorth = defineRoute({
  id: "get_net_worth",
  method: "GET",
  path: "/net-worth",
  scope: "read",
  capability: "accounts",
  summary: `The net worth and every account by month end, through \`through\` (this month when missing), for \`months\` months (1-${MAX_MONTHS}, 24 when missing).`,
  actions: [],
  query: z.object({
    months: z.coerce.number().int().min(1).max(MAX_MONTHS).optional(),
    through: monthStart().optional(),
    includeArchived: z.enum(["true", "false"]).optional(),
  }),
  response: z.object({
    currency: z.string(),
    months: z.array(monthStart()),
    /** The accounts «in the net worth», held and summed, per month. */
    netWorth: z.array(z.object({ total: money().nullable(), partial: z.boolean(), estimated: z.boolean() })),
    total: money().nullable(),
    totalPartial: z.boolean(),
    /** The net worth at the end of the month before `through`. */
    previousTotal: money().nullable(),
    /** `total` from `previousTotal`. */
    change: delta,
    /** `total` from the net worth at the end of December of the year before `through`; null outside the window. */
    yearToDate: delta,
    /** The last month's `netWorth` from the first known one of the window: what the chart's header says. */
    windowChange: delta,
    buckets: z.object({
      cash: bucketTotal,
      savings: bucketTotal,
      investments: bucketTotal,
      other: bucketTotal,
    }),
    /**
     * `buckets.investments` in the two groups of Investments (R5b): their totals add up to it, and each
     * is the subtotal of its group on the home of Investments. A group with no account is not listed.
     */
    investmentGroups: z.array(bucketTotal.extend({ id: z.enum(PORTFOLIO_GROUPS) })),
    alerts: z.array(z.object({ accountId: id(), kind: z.enum(["low_balance", "stale_sync"]) })),
    /** The currencies of accounts counted today that have no rate to `currency`. */
    missingRates: z.array(z.string()),
    lastSnapshotMonth: monthStart().nullable(),
    accounts: z.array(viewRow),
  }),
  errors: ["invalid"],
  example: {
    query: { months: "2", through: "2026-11-01" },
    response: {
      currency: "EUR",
      months: ["2026-10-01", "2026-11-01"],
      netWorth: [
        { total: "11545.84", partial: false, estimated: false },
        { total: "11302.40", partial: false, estimated: false },
      ],
      total: "11302.40",
      totalPartial: false,
      previousTotal: "11545.84",
      change: { amount: "-243.44", fraction: -0.0210849 },
      yearToDate: { amount: null, fraction: null },
      windowChange: { amount: "-243.44", fraction: -0.0210849 },
      buckets: {
        cash: { total: "11302.40", partial: false, count: 1 },
        savings: { total: null, partial: false, count: 0 },
        investments: { total: null, partial: false, count: 0 },
        other: { total: null, partial: false, count: 0 },
      },
      investmentGroups: [],
      alerts: [],
      missingRates: [],
      lastSnapshotMonth: "2026-10-01",
      accounts: [VIEW_ROW_EXAMPLE],
    },
  },
});

export const getAccountDailyBalances = defineRoute({
  id: "get_account_daily_balances",
  method: "GET",
  path: "/accounts/{id}/daily-balances",
  scope: "read",
  capability: "accounts",
  summary: `One account day by day from \`from\` to \`to\` (both included, at most ${MAX_DAYS} days, cut at today): readings held, a synced account rebuilt from its movements.`,
  actions: [],
  params: byAccount,
  query: z.object({ from: civilDate(), to: civilDate() }),
  response: z.object({
    days: z.array(z.string()),
    values: z.array(money().nullable()),
    /** Per day, whether the value stands on its movements rather than on a reading. */
    estimated: z.array(z.boolean()),
    /** Each day from the one before; the first has none (amount and fraction null). */
    changes: z.array(delta),
  }),
  errors: ["invalid", "not_found"],
  example: {
    params: { id: ACCOUNT_ID },
    query: { from: "2026-11-01", to: "2026-11-02" },
    response: {
      days: ["2026-11-01", "2026-11-02"],
      values: ["11302.40", "11250.00"],
      estimated: [false, true],
      changes: [
        { amount: null, fraction: null },
        { amount: "-52.40", fraction: -0.0046363 },
      ],
    },
  },
});

/** The longest window of the daily net worth: a year of days, as the chart draws it. */
const MAX_NET_WORTH_DAYS = 366;

export const getNetWorthDaily = defineRoute({
  id: "get_net_worth_daily",
  method: "GET",
  path: "/net-worth/daily",
  scope: "read",
  capability: "accounts",
  summary: `The accounts «in the net worth» day by day from \`from\` to \`to\`, in the display currency at the rate of each day: at most the last ${MAX_NET_WORTH_DAYS} days of the window, cut at today.`,
  actions: [],
  query: z.object({ from: civilDate(), to: civilDate() }),
  response: z.object({
    currency: z.string(),
    days: z.array(z.string()),
    /** Summed like the net worth: unknown only when every account is. */
    total: z.array(money().nullable()),
    /** Per day, whether any account stands on its movements rather than on a reading. */
    estimated: z.array(z.boolean()),
    /** The last day's `total` from the first known one of the window: what the chart's header says. */
    windowChange: delta,
    accounts: z.array(
      z.object({ id: id(), values: z.array(money().nullable()), estimated: z.array(z.boolean()) }),
    ),
  }),
  errors: ["invalid"],
  example: {
    query: { from: "2026-11-01", to: "2026-11-02" },
    response: {
      currency: "EUR",
      days: ["2026-11-01", "2026-11-02"],
      total: ["11302.40", "11250.00"],
      estimated: [false, true],
      windowChange: { amount: "-52.40", fraction: -0.0046363 },
      accounts: [{ id: ACCOUNT_ID, values: ["11302.40", "11250.00"], estimated: [false, true] }],
    },
  },
});

const SWITCH_OFFERS = ["none", "connect_first", "offer"] as const;

export const getAccountContext = defineRoute({
  id: "get_account_context",
  method: "GET",
  path: "/accounts/{id}/context",
  scope: "read",
  capability: "accounts",
  summary:
    "What an account's page shows around its figures: its provider, Investments, the pockets, subscriptions and interest rules on it, and the switch to the bank.",
  actions: [],
  params: byAccount,
  response: z.object({
    /** The provider's name as a person calls it; null for a manual account. */
    providerLabel: z.string().nullable(),
    /** The connection the account comes from (its row is in `GET /connections`); null with none. */
    connectionId: id().nullable(),
    /** A service of Investments: its page is in Investments. */
    inInvestments: z.boolean(),
    /** Investments writes its balances: no balance is recorded by hand. */
    managed: z.boolean(),
    pockets: z.array(z.object({ id: id(), name: z.string() })),
    /** The subscriptions paid from it, and what they cost a month, in the account's currency. */
    subscriptions: z.object({ count: z.number().int(), monthly: money() }),
    interestRules: z.array(
      z.object({
        id: id(),
        /** `upTo` null on the last tier: everything above. `annualRate` a fraction ("0.0275"). */
        tiers: z.array(z.object({ upTo: money().nullable(), annualRate: z.string() })),
      }),
    ),
    /** The switch to the bank still open on it, or null. */
    switch: z
      .object({
        source: z.string(),
        appliedAt: instant(),
        cutDate: civilDate(),
        transfers: z.number().int(),
        publishes: z.boolean(),
        /** The account it was joined to, by name. */
        joined: z.string().nullable(),
        /** The source of before is still connected: «Undo switch» can run. */
        sourceConnected: z.boolean(),
        /** What «Apply» counted, for the step «Done»: movements matched, new, transfers, joined. */
        counts: z.object({
          matched: z.number().int(),
          fresh: z.number().int(),
          transfers: z.number().int(),
          joined: z.number().int(),
        }),
      })
      .nullable(),
    /** With no open switch: `offer` it can move to a connected bank, `connect_first` no bank yet, `none` not at all. */
    switchOffer: z.enum(SWITCH_OFFERS),
  }),
  errors: ["invalid", "not_found"],
  example: {
    params: { id: ACCOUNT_ID },
    response: {
      providerLabel: null,
      connectionId: null,
      inInvestments: false,
      managed: false,
      pockets: [],
      subscriptions: { count: 2, monthly: "24.98" },
      interestRules: [{ id: ACCOUNT_ID, tiers: [{ upTo: null, annualRate: "0.0275" }] }],
      switch: null,
      switchOffer: "none",
    },
  },
});
