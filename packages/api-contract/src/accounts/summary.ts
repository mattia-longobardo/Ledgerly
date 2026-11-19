// Accounts · the net worth on the wire (rewrite plan R2, 05-refactor.md §5.5; plan F8 §3.4.10):
// `GET /summary` keeps its answer of F8 (decision D1 gives `previousNetWorth` a value, ACC-2), and
// the monthly snapshot (spec §10.3) gets its read and «Take snapshot now» (decision D2, ACC-3: its
// total counts the accounts «in the snapshot», not «in the net worth»).
import { z } from "zod";
import { defineRoute } from "../route";
import { civilDate, instant, money, monthStart } from "../primitives";
import { SNAPSHOT_STATES } from "./shared";

export const getSummary = defineRoute({
  id: "get_summary",
  method: "GET",
  path: "/summary",
  scope: "read",
  capability: "accounts",
  summary: "Net worth, liquid cash, and this month's income, spending and net (the Home Assistant card).",
  actions: [],
  response: z.object({
    month: monthStart(),
    /** The display currency of netWorth, previousNetWorth and cash. */
    currency: z.string(),
    netWorth: money().nullable(),
    /** True when an account counted has no balance yet, or no exchange rate: the total is a floor. */
    netWorthPartial: z.boolean(),
    /** The net worth at the end of the previous month, as Overview shows the change (D1). */
    previousNetWorth: money().nullable(),
    cash: money().nullable(),
    cashPartial: z.boolean(),
    income: money(),
    expense: money(),
    net: money(),
    transactions: z.number().int(),
    accounts: z.number().int(),
    lastSnapshotMonth: monthStart().nullable(),
  }),
  errors: [],
  mcp: {
    title: "Summary",
    description:
      "Net worth, liquid cash, and this month's income, spending and net, as GET /api/v1/summary. " +
      "`currency` is the user's display currency, which netWorth, previousNetWorth and cash are " +
      "converted to at the ECB rate of their day. " +
      "`netWorthPartial`/`cashPartial` are true when an account counted has no balance yet, or no " +
      "exchange rate to that currency.",
  },
  example: {
    response: {
      month: "2026-11-01",
      currency: "EUR",
      netWorth: "43671.40",
      netWorthPartial: false,
      previousNetWorth: "43120.10",
      cash: "11302.40",
      cashPartial: false,
      income: "0.00",
      expense: "-243.44",
      net: "-243.44",
      transactions: 5,
      accounts: 4,
      lastSnapshotMonth: "2026-10-01",
    },
  },
});

/** One monthly snapshot: the total of the accounts «in the snapshot» at the end of `month`. */
const snapshot = z.object({
  month: monthStart(),
  state: z.enum(SNAPSHOT_STATES),
  accountsWritten: z.number().int(),
  accountsSkipped: z.number().int(),
  total: money().nullable(),
  /** The display currency of the day it ran: a past snapshot is never converted again. */
  totalCurrency: z.string(),
  /** The codes of what was missing (an account without a balance, a rate). */
  warnings: z.array(z.string()),
  ranAt: instant(),
});

const SNAPSHOT_EXAMPLE = {
  month: "2026-10-01",
  state: "success",
  accountsWritten: 4,
  accountsSkipped: 0,
  total: "43120.10",
  totalCurrency: "EUR",
  warnings: [],
  ranAt: "2026-11-01T05:00:00.000Z",
};

export const listSnapshots = defineRoute({
  id: "list_snapshots",
  method: "GET",
  path: "/snapshots",
  scope: "read",
  capability: "accounts",
  summary: "The last 24 monthly snapshots, newest first (Settings › Data).",
  actions: [],
  response: z.object({ snapshots: z.array(snapshot) }),
  errors: [],
  example: { response: { snapshots: [SNAPSHOT_EXAMPLE] } },
});

export const runSnapshot = defineRoute({
  id: "run_snapshot",
  method: "POST",
  path: "/snapshots",
  scope: "write",
  capability: "accounts",
  summary:
    "«Take snapshot now»: the run the monthly job does, for the month of `on` (the previous month when missing). It replaces that month's snapshot.",
  actions: ["runSnapshotNowAction"],
  body: z.object({ on: civilDate().optional() }).strict(),
  response: snapshot,
  status: 201,
  errors: ["invalid"],
  example: { body: { on: "2026-10-15" }, response: SNAPSHOT_EXAMPLE },
});
