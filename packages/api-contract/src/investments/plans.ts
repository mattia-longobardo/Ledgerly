// The purchase plans of a manual portfolio (rewrite plan R5d, step 2; 11-standardization.md §11.3): a
// plan buys one instrument at each due date, proposed for confirmation by default or written by the
// job. Mattia's answers of 23/11/2026: P1 B (a plan writes purchases only, never a deposit; its debit
// account only finds the bank movement to link), P2 A (a purchase the job cannot write becomes a
// proposal, with its reason), P3 C (fractions chosen per plan, on by default), P4 A (up to 60 past
// due dates at creation).
import { z } from "zod";
import { id } from "../primitives";
import { defineRoute } from "../route";
import {
  backfillBody,
  byPlan,
  byRun,
  confirmBody,
  MAX_BACKFILL_RUNS,
  PLAN_EXAMPLE,
  PLAN_ID,
  pastRunsList,
  planBody,
  planUpdateBody,
  plansList,
  previewBody,
  previewOut,
  RUN_ID,
  runsList,
} from "./plan-schemas";
import { ACCOUNT_ID, byService, EVENT_ID, INSTRUMENT_ID, INVESTMENT_ERRORS } from "./shared";

export * from "./plan-schemas";

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
      "for a basket plan its instruments with their weight in percent, the amount of each execution " +
      "(null: to type), the carry to the next execution; how often, the next due date and how many " +
      "executions wait to be confirmed or priced. Read only. Take the account id from list_investments.",
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
    "A basket purchase plan of a manual portfolio (PERS-681): 1-10 instruments whose weights make 100, " +
    "the amount of each execution in the portfolio's currency (fees on top), every N working days, weeks " +
    "or months, from today or later. Each due date proposes whole shares to confirm; what is not spent " +
    "goes to the next execution. `not_eligible` on a service that is not a manual portfolio; `invalid` " +
    "for weights that do not make 100, an instrument twice, a start in the past or the body of R5d.",
  actions: [],
  params: byService,
  body: planBody,
  response: z.object({ id: id() }),
  status: 201,
  errors: INVESTMENT_ERRORS,
  example: {
    params: { accountId: ACCOUNT_ID },
    body: {
      name: "Monthly ETFs",
      amount: "200.00",
      instruments: [
        { instrumentId: INSTRUMENT_ID, mic: "XMIL", weight: "60" },
        { assetId: "091a2b3c-4d5e-4f60-9172-1a2b3c4d5e6f", weight: "40" },
      ],
      frequency: "month",
      interval: 1,
      day: 5,
      startOn: "2026-12-05",
      endOn: null,
      runsLimit: null,
      debitAccountId: null,
      fee: { amount: "2.95", rate: null },
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
    "Changes a plan: its name, its end, its debit account or its fee; for a basket also its amount, its " +
    "instruments and its cadence, from the next execution (a proposal open stays as it is; a new cadence, " +
    "or the first amount of a converted plan, starts from today). Pauses it, starts it again or ends it. " +
    "The executions already written stay as they are.",
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
          currency: "EUR",
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
          budget: "224.75",
          carryIn: "24.75",
          carryOut: null,
          lines: [
            {
              assetId: "091a2b3c-4d5e-4f60-9172-1a2b3c4d5e6f",
              name: "An ETF",
              weight: "100",
              price: "37.12",
              priceCurrency: "EUR",
              priceOn: "2026-11-05",
              fxRate: null,
              target: "224.75",
              quantity: "6",
              spent: "222.72",
              state: "buy",
              eventId: null,
            },
          ],
        },
      ],
    },
  },
});

export const previewPlanRun = defineRoute({
  id: "preview_investment_plan_run",
  method: "POST",
  path: "/investments/{accountId}/plans/{planId}/runs/{runId}/preview",
  scope: "write",
  capability: "investments",
  summary:
    "A basket's proposal with the prices and the shares typed (PERS-681 §2.4): a price typed alone gives the " +
    "whole shares its part buys at it; shares typed win. The one place of the computation; nothing is " +
    "written. `not_editable` on an execution that is not proposed or on a plan of R5d.",
  actions: [],
  params: byRun,
  body: previewBody,
  response: previewOut,
  errors: INVESTMENT_ERRORS,
  example: {
    params: { accountId: ACCOUNT_ID, planId: PLAN_ID, runId: RUN_ID },
    body: { lines: [{ assetId: "091a2b3c-4d5e-4f60-9172-1a2b3c4d5e6f", unitPrice: "37.5" }] },
    response: {
      runId: RUN_ID,
      currency: "EUR",
      budget: "224.75",
      spent: "187.50",
      carryOut: "37.25",
      lines: [
        {
          assetId: "091a2b3c-4d5e-4f60-9172-1a2b3c4d5e6f",
          name: "An ETF",
          weight: "100",
          price: "37.5",
          fxRate: null,
          target: "224.75",
          quantity: "5",
          spent: "187.50",
          state: "buy",
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
    "written as by hand, never a deposit (P1). A basket's proposal takes `lines` (every line, each once): " +
    "one purchase a line with shares, all of them or none, and what is not spent goes to the next " +
    "execution. `negative_cash` and `quantity_exceeded` as for any purchase (record a deposit first; " +
    "nothing is written); `not_editable` on an instalment already recorded, skipped or expired.",
  actions: [],
  params: byRun,
  body: confirmBody,
  /** The purchase written (the first of a basket), and every one. */
  response: z.object({ id: id(), ids: z.array(id()) }),
  status: 201,
  errors: INVESTMENT_ERRORS,
  example: {
    params: { accountId: ACCOUNT_ID, planId: PLAN_ID, runId: RUN_ID },
    body: { unitPrice: "37.05" },
    response: { id: EVENT_ID, ids: [EVENT_ID] },
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
  summary:
    "Skips an instalment: it stays in the list as skipped, and nothing brings it back by itself. A basket's " +
    "execution carries its whole budget to the next one.",
  actions: [],
  params: byRun,
  response: null,
  status: 204,
  errors: INVESTMENT_ERRORS,
  example: { params: { accountId: ACCOUNT_ID, planId: PLAN_ID, runId: RUN_ID } },
});

export const listPastRuns = defineRoute({
  id: "list_investment_plan_past_runs",
  method: "GET",
  path: "/investments/{accountId}/plans/{planId}/backfill",
  scope: "investments:read",
  capability: "investments",
  summary:
    "The past due dates of a plan «Record the past instalments» offers: those before the plan was made, " +
    `with nothing recorded or skipped, at most ${MAX_BACKFILL_RUNS}, oldest first; each with the first close ` +
    "on or after it and the proposal at that close, when the registry has one.",
  actions: [],
  params: byPlan,
  response: pastRunsList,
  errors: ["invalid", "not_found"],
  example: {
    params: { accountId: ACCOUNT_ID, planId: PLAN_ID },
    response: {
      planId: PLAN_ID,
      currency: "EUR",
      runs: [
        {
          dueOn: "2025-01-05",
          price: "31.4",
          priceOn: "2025-01-06",
          proposal: {
            on: "2025-01-06",
            quantity: "3.184713",
            unitPrice: "31.4",
            amount: "100.00",
            fee: "2.95",
          },
        },
      ],
      more: false,
    },
  },
});

export const backfillPlan = defineRoute({
  id: "backfill_investment_plan",
  method: "POST",
  path: "/investments/{accountId}/plans/{planId}/backfill",
  scope: "write",
  capability: "investments",
  summary:
    "«Record the past instalments» of a plan that started in the past: one purchase for each due date " +
    `given, at most ${MAX_BACKFILL_RUNS}, all of them or none. A due date already recorded: \`not_editable\`. ` +
    "A date before the portfolio was made moves its start back to that date (with the deposits before " +
    "it); `before_positions` when the portfolio's days before were a value only («Switch to positions», " +
    "or an account that had a balance). A basket plan has no past executions: `invalid` " +
    "(`plan_model_retired`), a past purchase is recorded by hand.",
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
