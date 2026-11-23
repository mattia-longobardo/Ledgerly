// The purchase plans of a manual portfolio (rewrite plan R5d, step 2; 11-standardization.md §11.3): a
// plan buys one instrument at each due date, proposed for confirmation by default or written by the
// job. Mattia's answers of 23/11/2026: P1 B (a plan writes purchases only, never a deposit; its debit
// account only finds the bank movement to link), P2 A (a purchase the job cannot write becomes a
// proposal, with its reason), P3 C (fractions chosen per plan, on by default), P4 A (up to 60 past
// due dates at creation).
import { z } from "zod";
import { amountInput, civilDate, id, money } from "../primitives";
import { defineRoute } from "../route";
import { ACCOUNT_ID, byService, EVENT_ID, INSTRUMENT_ID, INVESTMENT_ERRORS } from "./shared";

export const PLAN_FREQUENCIES = ["week", "month", "quarter"] as const;
export const PLAN_MODES = ["propose", "auto"] as const;
export const PLAN_STATES = ["active", "paused", "ended"] as const;
export const PLAN_RUN_STATES = ["pending", "waiting_price", "proposed", "recorded", "skipped"] as const;
/** Why the job left an `auto` instalment to the person (P2): the refusal of the purchase. */
export const PLAN_RUN_REASONS = [
  "negative_cash",
  "quantity_exceeded",
  "wrong_mode",
  "before_period",
] as const;
/** The past due dates «Record the past instalments» takes at once (P4). */
export const MAX_BACKFILL_RUNS = 60;

const PLAN_ID = "6f708192-a3b4-45c6-87d8-708192a3b4c5";
const RUN_ID = "708192a3-b4c5-46d7-98e9-8192a3b4c5d6";

/** A quantity or a unit price: a plain decimal, not negative. */
const decimalInput = () => z.string().regex(/^\s*\d+(\.\d+)?\s*$/);
const byPlan = z.object({ accountId: id(), planId: id() });
const byRun = z.object({ accountId: id(), planId: id(), runId: id() });

/** The fee of each instalment (E3): an amount, or a rate of the instalment ("0.0019" is 0,19 %). */
const fee = z
  .object({ amount: amountInput().nullable().default(null), rate: decimalInput().nullable().default(null) })
  .strict()
  .refine((value) => (value.amount === null) !== (value.rate === null), "An amount or a rate");

const feeOut = z.object({ amount: money().nullable(), rate: z.string().nullable() });

export const planOut = z.object({
  id: id(),
  name: z.string(),
  /** The asset bought, with the instrument and the market of the order. */
  asset: z.object({ id: id(), name: z.string(), instrumentId: id().nullable(), mic: z.string().nullable() }),
  /** Each instalment buys for an amount, or a quantity: one of the two is null. */
  amount: money().nullable(),
  quantity: z.string().nullable(),
  /** A plan for an amount buys fractions of a unit, or whole units only (P3). */
  fractions: z.boolean(),
  frequency: z.enum(PLAN_FREQUENCIES),
  /** Every `interval` weeks, months or quarters. */
  interval: z.number().int(),
  /** The day of the month (1-31; the month's last when shorter), or of the week (1 Monday - 7) for `week`. */
  day: z.number().int(),
  startOn: civilDate(),
  /** The plan ends on a day or after a number of instalments, or never: at most one is set. */
  endOn: civilDate().nullable(),
  runsLimit: z.number().int().nullable(),
  /** The account the instalment is paid from (P1 B): only to find its bank movement, never a deposit. */
  debitAccountId: id().nullable(),
  fee: feeOut.nullable(),
  mode: z.enum(PLAN_MODES),
  state: z.enum(PLAN_STATES),
  nextDueOn: civilDate().nullable(),
  /** Instalments waiting for the person: to confirm, or with no price yet. */
  toConfirm: z.number().int(),
  waitingPrice: z.number().int(),
});

const PLAN_EXAMPLE = {
  id: PLAN_ID,
  name: "Monthly world ETF",
  asset: {
    id: "091a2b3c-4d5e-4f60-9172-1a2b3c4d5e6f",
    name: "An ETF",
    instrumentId: INSTRUMENT_ID,
    mic: "XMIL",
  },
  amount: "100.00",
  quantity: null,
  fractions: true,
  frequency: "month",
  interval: 1,
  day: 5,
  startOn: "2026-01-05",
  endOn: null,
  runsLimit: null,
  debitAccountId: null,
  fee: { amount: "2.95", rate: null },
  mode: "propose",
  state: "active",
  nextDueOn: "2026-12-05",
  toConfirm: 0,
  waitingPrice: 0,
} as const;

export const plansList = z.object({ accountId: id(), plans: z.array(planOut) });

export const planBody = z
  .object({
    name: z.string().trim().min(1).max(80),
    instrumentId: id(),
    mic: z
      .string()
      .regex(/^[A-Z0-9]{4}$/)
      .nullable()
      .default(null),
    amount: amountInput().nullable().default(null),
    quantity: decimalInput().nullable().default(null),
    fractions: z.boolean().default(true),
    frequency: z.enum(PLAN_FREQUENCIES),
    interval: z.number().int().min(1).max(12).default(1),
    day: z.number().int().min(1).max(31),
    startOn: civilDate(),
    endOn: civilDate().nullable().default(null),
    runsLimit: z.number().int().min(1).max(600).nullable().default(null),
    debitAccountId: id().nullable().default(null),
    fee: fee.nullable().default(null),
    mode: z.enum(PLAN_MODES).default("propose"),
  })
  .strict()
  .refine((plan) => (plan.amount === null) !== (plan.quantity === null), "An amount or a quantity")
  .refine((plan) => plan.endOn === null || plan.runsLimit === null, "An end day or a number of instalments")
  .refine((plan) => plan.frequency !== "week" || plan.day <= 7, "A day of the week is 1-7");

export const planUpdateBody = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    mode: z.enum(PLAN_MODES).optional(),
    state: z.enum(PLAN_STATES).optional(),
    endOn: civilDate().nullable().optional(),
    runsLimit: z.number().int().min(1).max(600).nullable().optional(),
    debitAccountId: id().nullable().optional(),
    fee: fee.nullable().optional(),
  })
  .strict();

/** What a proposed instalment would write: the form, filled in. */
const proposal = z.object({
  on: civilDate(),
  quantity: z.string(),
  unitPrice: z.string(),
  amount: money(),
  fee: money(),
});

export const runOut = z.object({
  id: id(),
  dueOn: civilDate(),
  state: z.enum(PLAN_RUN_STATES),
  /** The close the instalment is priced at, and its day: the first on or after the due date. */
  price: z.string().nullable(),
  priceOn: civilDate().nullable(),
  /** Since when no price was found: after 5 working days the person types it. */
  waitingSince: civilDate().nullable(),
  /** Why the job did not write it in `auto` (P2): `negative_cash`, `quantity_exceeded`; null otherwise. */
  reason: z.enum(PLAN_RUN_REASONS).nullable(),
  proposal: proposal.nullable(),
  /** The movement of the debit account the matcher found for it (E7): proposed, linked only when the person says. */
  debit: z
    .object({
      transactionId: id(),
      on: civilDate(),
      amount: money(),
      payee: z.string().nullable(),
      linked: z.boolean(),
    })
    .nullable(),
  /** The purchase written, and whether the job wrote it («automatic»). */
  eventId: id().nullable(),
  automatic: z.boolean(),
});

export const runsList = z.object({ planId: id(), runs: z.array(runOut) });

/** A confirmation may correct the proposal: its day, its quantity, its price and its fee. */
export const confirmBody = z
  .object({
    on: civilDate().optional(),
    quantity: decimalInput().optional(),
    unitPrice: decimalInput().optional(),
    fee: amountInput().optional(),
  })
  .strict();

export const backfillBody = z
  .object({
    runs: z
      .array(
        z
          .object({
            dueOn: civilDate(),
            on: civilDate(),
            quantity: decimalInput(),
            unitPrice: decimalInput(),
            fee: amountInput().nullable().default(null),
          })
          .strict(),
      )
      .min(1)
      .max(MAX_BACKFILL_RUNS),
  })
  .strict();

export const listPlans = defineRoute({
  id: "list_investment_plans",
  method: "GET",
  path: "/investments/{accountId}/plans",
  scope: "investments:read",
  capability: "investments",
  summary:
    "The purchase plans of a manual portfolio, with their next due date and the instalments waiting. " +
    "Any other service has none.",
  actions: [],
  params: byService,
  response: plansList,
  errors: ["invalid", "not_found"],
  mcp: {
    title: "Investment plans",
    description:
      "The purchase plans (PAC) of one manual portfolio, as GET /api/v1/investments/{accountId}/plans: " +
      "the instrument, the amount or quantity of each instalment, how often, the next due date, the mode " +
      "(proposed for confirmation, or automatic) and how many instalments wait to be confirmed or priced. " +
      "Read only. Take the account id from list_investments.",
    arguments: { account_id: z.uuid().describe("The portfolio's accountId, from list_investments.") },
    pathArguments: { accountId: "account_id" },
  },
  example: { params: { accountId: ACCOUNT_ID }, response: { accountId: ACCOUNT_ID, plans: [PLAN_EXAMPLE] } },
});

export const createPlan = defineRoute({
  id: "create_investment_plan",
  method: "POST",
  path: "/investments/{accountId}/plans",
  scope: "write",
  capability: "investments",
  summary:
    "A purchase plan of a manual portfolio: one instrument, an amount or a quantity, a frequency and a day. " +
    "`not_eligible` on a service that is not a manual portfolio. A start in the past leaves its due dates " +
    "to «Record the past instalments».",
  actions: [],
  params: byService,
  body: planBody,
  response: z.object({ id: id() }),
  status: 201,
  errors: INVESTMENT_ERRORS,
  example: {
    params: { accountId: ACCOUNT_ID },
    body: {
      name: "Monthly world ETF",
      instrumentId: INSTRUMENT_ID,
      mic: "XMIL",
      amount: "100.00",
      quantity: null,
      fractions: true,
      frequency: "month",
      interval: 1,
      day: 5,
      startOn: "2026-12-05",
      endOn: null,
      runsLimit: null,
      debitAccountId: null,
      fee: { amount: "2.95", rate: null },
      mode: "propose",
    },
    response: { id: PLAN_ID },
  },
});

export const updatePlan = defineRoute({
  id: "update_investment_plan",
  method: "PATCH",
  path: "/investments/{accountId}/plans/{planId}",
  scope: "write",
  capability: "investments",
  summary:
    "Changes a plan: its name, its mode, its end, its debit account or its fee; pauses it, starts it again " +
    "or ends it. The instalments already written stay as they are.",
  actions: [],
  params: byPlan,
  body: planUpdateBody,
  response: null,
  status: 204,
  errors: INVESTMENT_ERRORS,
  example: { params: { accountId: ACCOUNT_ID, planId: PLAN_ID }, body: { state: "paused" } },
});

export const listPlanRuns = defineRoute({
  id: "list_investment_plan_runs",
  method: "GET",
  path: "/investments/{accountId}/plans/{planId}/runs",
  scope: "investments:read",
  capability: "investments",
  summary:
    "The instalments of a plan, newest first: due, waiting for a price, proposed, recorded or skipped.",
  actions: [],
  params: byPlan,
  response: runsList,
  errors: ["invalid", "not_found"],
  example: {
    params: { accountId: ACCOUNT_ID, planId: PLAN_ID },
    response: {
      planId: PLAN_ID,
      runs: [
        {
          id: RUN_ID,
          dueOn: "2026-11-05",
          state: "proposed",
          price: "37.12",
          priceOn: "2026-11-05",
          waitingSince: null,
          reason: null,
          proposal: {
            on: "2026-11-05",
            quantity: "2.614224",
            unitPrice: "37.12",
            amount: "97.04",
            fee: "2.95",
          },
          debit: null,
          eventId: null,
          automatic: false,
        },
      ],
    },
  },
});

export const confirmPlanRun = defineRoute({
  id: "confirm_investment_plan_run",
  method: "POST",
  path: "/investments/{accountId}/plans/{planId}/runs/{runId}/confirm",
  scope: "write",
  capability: "investments",
  summary:
    "Confirms a proposed instalment, or one waiting for a price, with the corrections typed: the purchase is " +
    "written as by hand, never a deposit (P1). `negative_cash` and `quantity_exceeded` as for any purchase " +
    "(record a deposit first); `not_editable` on an instalment already recorded or skipped.",
  actions: [],
  params: byRun,
  body: confirmBody,
  response: z.object({ id: id() }),
  status: 201,
  errors: INVESTMENT_ERRORS,
  example: {
    params: { accountId: ACCOUNT_ID, planId: PLAN_ID, runId: RUN_ID },
    body: { unitPrice: "37.05" },
    response: { id: EVENT_ID },
  },
});

export const linkPlanRunDebit = defineRoute({
  id: "link_investment_plan_run_debit",
  method: "POST",
  path: "/investments/{accountId}/plans/{planId}/runs/{runId}/debit",
  scope: "write",
  capability: "investments",
  summary:
    "Links a recorded instalment to the bank movement the matcher proposed (E7): the movement documents the " +
    "purchase, and Subscriptions no longer sees it. `not_editable` with no movement proposed or one linked.",
  actions: [],
  params: byRun,
  response: null,
  status: 204,
  errors: INVESTMENT_ERRORS,
  example: { params: { accountId: ACCOUNT_ID, planId: PLAN_ID, runId: RUN_ID } },
});

export const skipPlanRun = defineRoute({
  id: "skip_investment_plan_run",
  method: "POST",
  path: "/investments/{accountId}/plans/{planId}/runs/{runId}/skip",
  scope: "write",
  capability: "investments",
  summary: "Skips an instalment: it stays in the list as skipped, and nothing brings it back by itself.",
  actions: [],
  params: byRun,
  response: null,
  status: 204,
  errors: INVESTMENT_ERRORS,
  example: { params: { accountId: ACCOUNT_ID, planId: PLAN_ID, runId: RUN_ID } },
});

export const backfillPlan = defineRoute({
  id: "backfill_investment_plan",
  method: "POST",
  path: "/investments/{accountId}/plans/{planId}/backfill",
  scope: "write",
  capability: "investments",
  summary:
    "«Record the past instalments» of a plan that started in the past: one purchase for each due date " +
    `given, at most ${MAX_BACKFILL_RUNS}, all of them or none. A due date already recorded: \`not_editable\`.`,
  actions: [],
  params: byPlan,
  body: backfillBody,
  response: z.object({ ids: z.array(id()) }),
  status: 201,
  errors: INVESTMENT_ERRORS,
  example: {
    params: { accountId: ACCOUNT_ID, planId: PLAN_ID },
    body: {
      runs: [{ dueOn: "2026-10-05", on: "2026-10-06", quantity: "2.7", unitPrice: "36.9", fee: "2.95" }],
    },
    response: { ids: [EVENT_ID] },
  },
});
