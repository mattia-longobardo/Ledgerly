// Accounts · the reads of the views (rewrite plan R2, 05-refactor.md §5.5; orchestrator's scope of
// the step): what Overview, the list of accounts and an account's page draw, from the same total
// as `GET /summary` and the snapshot (ACC-1, ACC-3/D2). Every total is in the display currency;
// an account's own fields are in its currency.
import { z } from "zod";
import { defineRoute } from "../route";
import { civilDate, id, money, monthStart } from "../primitives";
import { ACCOUNT_ID, ACCOUNT_ORIGINS, ACCOUNT_STATES, ACCOUNT_TYPES, byAccount } from "./shared";

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
  held: ["11545.84", "11302.40"],
  display: { balance: "11302.40", previous: "11545.84", held: ["11545.84", "11302.40"] },
  missingRate: false,
  stale: false,
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
    buckets: z.object({
      cash: bucketTotal,
      savings: bucketTotal,
      investments: bucketTotal,
      other: bucketTotal,
    }),
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
      buckets: {
        cash: { total: "11302.40", partial: false, count: 1 },
        savings: { total: null, partial: false, count: 0 },
        investments: { total: null, partial: false, count: 0 },
        other: { total: null, partial: false, count: 0 },
      },
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
  }),
  errors: ["invalid", "not_found"],
  example: {
    params: { id: ACCOUNT_ID },
    query: { from: "2026-11-01", to: "2026-11-02" },
    response: {
      days: ["2026-11-01", "2026-11-02"],
      values: ["11302.40", "11250.00"],
      estimated: [false, true],
    },
  },
});
