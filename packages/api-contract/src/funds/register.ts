// The register of a fund (rewrite plan R2, 05-refactor.md §5.5 «funds»): the values recorded by hand,
// the operations a person writes, and the reviewer's word on a difference with the payslips.
import { z } from "zod";
import { id } from "../primitives";
import { defineRoute } from "../route";
import { operationBody, valuationBody } from "./bodies";
import { byFund, COMPONENTS, FUND_ERRORS, FUND_ID, OPERATION_ID, VALUATION_ID } from "./shared";

const byValuation = z.object({ id: id(), valuationId: id() });
const byOperation = z.object({ id: id(), operationId: id() });
const byPeriod = z.object({
  id: id(),
  year: z.coerce.number().int().min(1990).max(2200),
  index: z.coerce.number().int().min(1).max(12),
  component: z.enum(COMPONENTS),
});

const VALUATION_EXAMPLE = { on: "2026-10-01", value: "12450.00", note: null };

export const recordValuation = defineRoute({
  id: "record_fund_valuation",
  method: "POST",
  path: "/funds/{id}/valuations",
  scope: "write",
  capability: "funds",
  summary: "Records what the fund is worth on a day (not in the future). A day that has a value moves it.",
  actions: ["recordValuationAction"],
  params: byFund,
  body: valuationBody,
  response: z.object({ id: id() }),
  status: 201,
  errors: FUND_ERRORS,
  example: { params: { id: FUND_ID }, body: VALUATION_EXAMPLE, response: { id: VALUATION_ID } },
});

export const updateValuation = defineRoute({
  id: "update_fund_valuation",
  method: "PATCH",
  path: "/funds/{id}/valuations/{valuationId}",
  scope: "write",
  capability: "funds",
  summary: "Changes a recorded value: a new day moves it, it never leaves a second one behind.",
  actions: ["updateValuationAction"],
  params: byValuation,
  body: valuationBody,
  response: null,
  status: 204,
  errors: FUND_ERRORS,
  example: { params: { id: FUND_ID, valuationId: VALUATION_ID }, body: VALUATION_EXAMPLE },
});

export const deleteValuation = defineRoute({
  id: "delete_fund_valuation",
  method: "DELETE",
  path: "/funds/{id}/valuations/{valuationId}",
  scope: "write",
  capability: "funds",
  summary: "Deletes a recorded value.",
  actions: ["deleteValuationAction"],
  params: byValuation,
  response: null,
  status: 204,
  errors: FUND_ERRORS,
  example: { params: { id: FUND_ID, valuationId: VALUATION_ID } },
});

export const addOperation = defineRoute({
  id: "add_fund_operation",
  method: "POST",
  path: "/funds/{id}/operations",
  scope: "write",
  capability: "funds",
  summary:
    "Writes a contribution (voluntary, tied or not to the movement that paid it; or from the payslip, by " +
    "component, for a period) or another operation (joining, transfer in, switch, exit). `fee` null: unknown.",
  actions: ["saveContributionAction:add"],
  params: byFund,
  body: operationBody,
  response: z.object({ id: id() }),
  status: 201,
  errors: FUND_ERRORS,
  example: {
    params: { id: FUND_ID },
    body: {
      kind: "voluntary",
      on: "2026-11-02",
      amount: "500.00",
      fee: null,
      transactionId: null,
      note: null,
    },
    response: { id: OPERATION_ID },
  },
});

export const updateOperation = defineRoute({
  id: "update_fund_operation",
  method: "PATCH",
  path: "/funds/{id}/operations/{operationId}",
  scope: "write",
  capability: "funds",
  summary: "Rewrites an operation written by hand.",
  actions: ["saveContributionAction:update"],
  params: byOperation,
  body: operationBody,
  response: null,
  status: 204,
  errors: FUND_ERRORS,
  example: {
    params: { id: FUND_ID, operationId: OPERATION_ID },
    body: {
      kind: "voluntary",
      on: "2026-11-02",
      amount: "500.00",
      fee: "0.00",
      transactionId: null,
      note: null,
    },
  },
});

export const deleteOperation = defineRoute({
  id: "delete_fund_operation",
  method: "DELETE",
  path: "/funds/{id}/operations/{operationId}",
  scope: "write",
  capability: "funds",
  summary: "Deletes an operation of the register.",
  actions: ["deleteContributionAction"],
  params: byOperation,
  response: null,
  status: 204,
  errors: FUND_ERRORS,
  example: { params: { id: FUND_ID, operationId: OPERATION_ID } },
});

/**
 * «Accept the difference» of one component in one period. The server reads the difference, the
 * amounts and the lines it is made of from its own reconciliation: the caller gives only the note.
 */
export const decideDifference = defineRoute({
  id: "decide_fund_difference",
  method: "PUT",
  path: "/funds/{id}/periods/{year}/{index}/{component}/decision",
  scope: "write",
  capability: "funds",
  summary:
    "Accepts the difference between what the payslips accrued and what the fund credited for one component " +
    "of one period, with a note. The difference is the server's; when it changes, the decision lapses.",
  actions: ["decideDifferenceAction"],
  params: byPeriod,
  body: z.object({ note: z.string().min(1).max(500) }).strict(),
  response: null,
  status: 204,
  errors: FUND_ERRORS,
  example: {
    params: { id: FUND_ID, year: "2026", index: "2", component: "tfr" },
    body: { note: "Rounding of the fund" },
  },
});

export const clearDecision = defineRoute({
  id: "clear_fund_decision",
  method: "DELETE",
  path: "/funds/{id}/periods/{year}/{index}/{component}/decision",
  scope: "write",
  capability: "funds",
  summary: "Withdraws an accepted difference: the component is a discrepancy again.",
  actions: ["clearDecisionAction"],
  params: byPeriod,
  response: null,
  status: 204,
  errors: FUND_ERRORS,
  example: { params: { id: FUND_ID, year: "2026", index: "2", component: "tfr" } },
});
