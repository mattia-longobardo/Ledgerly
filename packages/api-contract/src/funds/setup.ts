// What feeds a fund (rewrite plan R2, 05-refactor.md §5.5 «funds»): its sources of contributions and
// its fees, «Find this charge everywhere» and «Rebuild from payslips». A payslip source publishes the
// competences of the payslips already applied, as the action of the web does: `published` says how many.
import { z } from "zod";
import { id, money } from "../primitives";
import { defineRoute } from "../route";
import { feeBody, sourceBody } from "./bodies";
import { FEE_EXAMPLE, SOURCE_EXAMPLE } from "./examples";
import {
  ACCOUNT_ID,
  byFund,
  FEE_ID,
  feeRow,
  FUND_ERRORS,
  FUND_ID,
  SOURCE_ID,
  SOURCE_STATES,
  sourceRow,
  TRANSACTION_ID,
} from "./shared";

const bySource = z.object({ id: id(), sourceId: id() });
const byFee = z.object({ id: id(), feeId: id() });
const published = z.object({ id: id(), published: z.number().int() });

export const addSource = defineRoute({
  id: "add_fund_source",
  method: "POST",
  path: "/funds/{id}/sources",
  scope: "write",
  capability: "funds",
  summary:
    "Adds a source of contributions: the payslip (components and period), a recurring bank debit, or by " +
    "hand. One active payslip source per fund; a component goes to one fund only.",
  actions: [],
  params: byFund,
  body: sourceBody,
  response: published,
  status: 201,
  errors: FUND_ERRORS,
  example: {
    params: { id: FUND_ID },
    body: { kind: "manual" },
    response: { id: SOURCE_ID, published: 0 },
  },
});

export const updateSource = defineRoute({
  id: "update_fund_source",
  method: "PATCH",
  path: "/funds/{id}/sources/{sourceId}",
  scope: "write",
  capability: "funds",
  summary: "Rewrites a source. A payslip source publishes the applied payslips again.",
  actions: [],
  params: bySource,
  body: sourceBody,
  response: published,
  errors: FUND_ERRORS,
  example: {
    params: { id: FUND_ID, sourceId: SOURCE_ID },
    body: { kind: "manual" },
    response: { id: SOURCE_ID, published: 0 },
  },
});

export const setSourceState = defineRoute({
  id: "set_fund_source_state",
  method: "PUT",
  path: "/funds/{id}/sources/{sourceId}/state",
  scope: "write",
  capability: "funds",
  summary: "Pauses a source or makes it active again.",
  actions: [],
  params: bySource,
  body: z.object({ state: z.enum(SOURCE_STATES) }).strict(),
  response: null,
  status: 204,
  errors: FUND_ERRORS,
  example: { params: { id: FUND_ID, sourceId: SOURCE_ID }, body: { state: "paused" } },
});

/** What a removal took away: the source as it was and its own fees, for «Undo». */
const removed = z.object({ source: sourceRow, fees: z.array(feeRow) });

export const removeSource = defineRoute({
  id: "remove_fund_source",
  method: "DELETE",
  path: "/funds/{id}/sources/{sourceId}",
  scope: "write",
  capability: "funds",
  summary:
    "Removes a source with no contribution (one with contributions is paused instead: `conflict`). Answers " +
    "the source and its own fees as they were, which `restore_fund_source` takes back.",
  actions: [],
  params: bySource,
  response: removed,
  errors: FUND_ERRORS,
  example: {
    params: { id: FUND_ID, sourceId: SOURCE_ID },
    response: { source: SOURCE_EXAMPLE, fees: [FEE_EXAMPLE] },
  },
});

export const restoreSource = defineRoute({
  id: "restore_fund_source",
  method: "POST",
  path: "/funds/{id}/sources/restore",
  scope: "write",
  capability: "funds",
  summary: "«Undo» of a removal: the source and its fees come back with the ids they had.",
  actions: [],
  params: byFund,
  body: removed,
  response: null,
  status: 204,
  errors: FUND_ERRORS,
  example: { params: { id: FUND_ID }, body: { source: SOURCE_EXAMPLE, fees: [FEE_EXAMPLE] } },
});

export const addFee = defineRoute({
  id: "add_fund_fee",
  method: "POST",
  path: "/funds/{id}/fees",
  scope: "write",
  capability: "funds",
  summary:
    "Adds a fee: an amount or a percentage, on what it is charged, how often, and when it is in force.",
  actions: [],
  params: byFund,
  /** `id`: the «Undo» of a removal, the fee comes back as it was. */
  body: feeBody.extend({ id: id().optional() }),
  response: z.object({ id: id() }),
  status: 201,
  errors: FUND_ERRORS,
  example: {
    params: { id: FUND_ID },
    body: { label: "Contribution fee", basis: "per_contribution", amount: "3.00", sourceId: SOURCE_ID },
    response: { id: FEE_ID },
  },
});

export const updateFee = defineRoute({
  id: "update_fund_fee",
  method: "PATCH",
  path: "/funds/{id}/fees/{feeId}",
  scope: "write",
  capability: "funds",
  summary: "Rewrites a fee.",
  actions: [],
  params: byFee,
  body: feeBody,
  response: null,
  status: 204,
  errors: FUND_ERRORS,
  example: {
    params: { id: FUND_ID, feeId: FEE_ID },
    body: { label: "Contribution fee", basis: "per_contribution", amount: "3.50" },
  },
});

export const removeFee = defineRoute({
  id: "remove_fund_fee",
  method: "DELETE",
  path: "/funds/{id}/fees/{feeId}",
  scope: "write",
  capability: "funds",
  summary: "Removes a fee.",
  actions: [],
  params: byFee,
  response: null,
  status: 204,
  errors: FUND_ERRORS,
  example: { params: { id: FUND_ID, feeId: FEE_ID } },
});

/** «Find this charge everywhere»: what the app would match on, before anything is saved. Read only. */
export const debitMatch = defineRoute({
  id: "get_fund_debit_match",
  method: "GET",
  path: "/funds/{id}/debit-match",
  scope: "read",
  capability: "funds",
  summary:
    "From one movement, the text a recurring debit would match on and the charges it already finds: how " +
    "many, the first and the last, the median amount and the interval. `found` null: nothing to match on.",
  actions: [],
  params: byFund,
  query: z.object({ transactionId: id(), accountId: id().optional() }),
  response: z.object({
    found: z
      .object({
        kind: z.enum(["creditor", "mandate", "payee"]),
        text: z.string(),
        count: z.number().int(),
        first: z.string().nullable(),
        last: z.string().nullable(),
        median: money().nullable(),
        intervalDays: z.number().int().nullable(),
      })
      .nullable(),
  }),
  errors: FUND_ERRORS,
  example: {
    params: { id: FUND_ID },
    query: { transactionId: TRANSACTION_ID, accountId: ACCOUNT_ID },
    response: {
      found: {
        kind: "creditor",
        text: "EXAMPLE PENSION FUND",
        count: 6,
        first: "2026-05-05",
        last: "2026-10-05",
        median: "100.00",
        intervalDays: 30,
      },
    },
  },
});

/** Settings › «Rebuild from payslips»: the competences read again from every applied payslip. */
export const rebuildCompetences = defineRoute({
  id: "rebuild_fund_competences",
  method: "POST",
  path: "/funds/{id}/competences/rebuild",
  scope: "write",
  capability: "funds",
  summary:
    "Reads again what every applied payslip accrued for the fund. Answers how many periods it published.",
  actions: [],
  params: byFund,
  response: z.object({ published: z.number().int() }),
  errors: FUND_ERRORS,
  example: { params: { id: FUND_ID }, response: { published: 8 } },
});
