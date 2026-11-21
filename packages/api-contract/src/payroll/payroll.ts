// Payroll (rewrite plan R2, 05-refactor.md §5.5 «payroll»; audit PAY-8): the register of the Payroll
// page and one payslip's review, as `get_payroll` and `get_payslip` show them too, and the writes of
// the review. Applying a payslip raises the event `PayslipApplied`, the same for an action and a
// route: the pension fund decides on its own what it means. The upload stays `POST /imports`.
import { z } from "zod";
import { defineRoute } from "../route";
import {
  byPayslip,
  DOCUMENT_ID,
  PAYROLL_ERRORS,
  payrollRegister,
  payslipReview,
  REGISTER_EXAMPLE,
  REVIEW_EXAMPLE,
} from "./shared";

export const getPayroll = defineRoute({
  id: "get_payroll",
  method: "GET",
  path: "/payroll/payslips",
  scope: "read",
  capability: "payroll",
  summary:
    "The register of payslips by year, with the year's totals and monthly means over the applied ones, " +
    "the documents still being read or waiting, and the KPIs over the applied ordinary payslips.",
  actions: [],
  response: payrollRegister,
  errors: [],
  mcp: {
    title: "Payroll",
    description:
      "Every payslip applied or waiting for a decision, by year: gross, taxes, social, net and the other " +
      "amounts, the leave left in hours, the year's totals and means; the mean net of the last 3, 6 and 12 " +
      "months, the tax rate and the yearly gross (RAL). Amounts are decimal strings.",
  },
  example: { response: REGISTER_EXAMPLE },
});

export const getPayslip = defineRoute({
  id: "get_payslip",
  method: "GET",
  path: "/payroll/payslips/{id}",
  scope: "read",
  capability: "payroll",
  summary:
    "One payslip's review: every value read and where from, the corrections, the checks and the warnings, " +
    "the leave it accounts for, and its body lines with the role of each code.",
  actions: [],
  params: byPayslip,
  response: payslipReview,
  errors: ["not_found"],
  mcp: {
    title: "Payslip",
    description:
      "One payslip by its document id (from get_payroll): its values with origin and verification, the " +
      "checks that passed or failed, the warnings, the leave taken by month and the body lines.",
    arguments: { id: z.uuid().describe("The payslip's document id.") },
    pathArguments: { id: "id" },
  },
  example: { params: { id: DOCUMENT_ID }, response: REVIEW_EXAMPLE },
});

export const decidePayslipField = defineRoute({
  id: "decide_payslip_field",
  method: "PUT",
  path: "/payroll/payslips/{id}/fields/{field}",
  scope: "write",
  capability: "payroll",
  summary:
    "Confirms a value as read (`value` null) or corrects it, in canonical form: amounts and hours " +
    "\"1234.56\", dates YYYY-MM-DD. A verified payslip that changes goes back to review. Answers the review.",
  actions: ["decideFieldAction"],
  params: z.object({ id: z.uuid(), field: z.string().min(1).max(40) }),
  body: z.object({ value: z.string().max(100).nullable() }).strict(),
  response: payslipReview,
  errors: PAYROLL_ERRORS,
  example: {
    params: { id: DOCUMENT_ID, field: "netPay" },
    body: { value: null },
    response: REVIEW_EXAMPLE,
  },
});

export const verifyPayslip = defineRoute({
  id: "verify_payslip",
  method: "POST",
  path: "/payroll/payslips/{id}/verify",
  scope: "write",
  capability: "payroll",
  summary:
    "A person vouches for the payslip: every inferred value decided first; failed checks only with " +
    "`acknowledgeFailures`.",
  actions: ["verifyPayslipAction"],
  params: byPayslip,
  body: z.object({ acknowledgeFailures: z.boolean() }).strict(),
  response: null,
  status: 204,
  errors: PAYROLL_ERRORS,
  example: { params: { id: DOCUMENT_ID }, body: { acknowledgeFailures: false } },
});

export const applyPayslip = defineRoute({
  id: "apply_payslip",
  method: "POST",
  path: "/payroll/payslips/{id}/apply",
  scope: "write",
  capability: "payroll",
  summary:
    "Applies a verified payslip: it enters the register, the payslip with its key is superseded, its leave " +
    "reaches time off and its contributions the pension fund that takes them.",
  actions: ["applyPayslipAction"],
  params: byPayslip,
  response: null,
  status: 204,
  errors: PAYROLL_ERRORS,
  example: { params: { id: DOCUMENT_ID } },
});

export const reopenPayslip = defineRoute({
  id: "reopen_payslip",
  method: "POST",
  path: "/payroll/payslips/{id}/reopen",
  scope: "write",
  capability: "payroll",
  summary:
    "Takes an applied payslip back to review; `restored`: the payslip it had replaced is applied again.",
  actions: ["reopenPayslipAction"],
  params: byPayslip,
  response: z.object({ restored: z.boolean() }),
  errors: PAYROLL_ERRORS,
  example: { params: { id: DOCUMENT_ID }, response: { restored: false } },
});

export const rejectPayslip = defineRoute({
  id: "reject_payslip",
  method: "POST",
  path: "/payroll/payslips/{id}/reject",
  scope: "write",
  capability: "payroll",
  summary: "Sets a payslip aside; nothing was applied from it.",
  actions: ["rejectPayslipAction"],
  params: byPayslip,
  response: null,
  status: 204,
  errors: PAYROLL_ERRORS,
  example: { params: { id: DOCUMENT_ID } },
});

export const retryPayslip = defineRoute({
  id: "retry_payslip",
  method: "POST",
  path: "/payroll/payslips/{id}/retry",
  scope: "write",
  capability: "payroll",
  summary: "Reads the original again, keeping what a person decided on values that did not change.",
  actions: ["retryPayslipAction"],
  params: byPayslip,
  response: null,
  status: 204,
  errors: PAYROLL_ERRORS,
  example: { params: { id: DOCUMENT_ID } },
});

export const renamePayslip = defineRoute({
  id: "rename_payslip",
  method: "PATCH",
  path: "/payroll/payslips/{id}",
  scope: "write",
  capability: "payroll",
  summary: "Renames a payslip's document, whatever its state.",
  actions: ["renamePayslipAction"],
  params: byPayslip,
  body: z.object({ name: z.string().min(1).max(200) }).strict(),
  response: null,
  status: 204,
  errors: PAYROLL_ERRORS,
  example: { params: { id: DOCUMENT_ID }, body: { name: "payslip-2026-03.pdf" } },
});

export const deletePayslip = defineRoute({
  id: "delete_payslip",
  method: "DELETE",
  path: "/payroll/payslips/{id}",
  scope: "write",
  capability: "payroll",
  summary:
    "Deletes a payslip with its original; an applied one leaves the register first. `unapplied`: it was " +
    "applied; `restored`: the payslip it had replaced is applied again.",
  actions: ["deletePayslipDocumentAction"],
  params: byPayslip,
  response: z.object({ unapplied: z.boolean(), restored: z.boolean() }),
  errors: PAYROLL_ERRORS,
  example: { params: { id: DOCUMENT_ID }, response: { unapplied: false, restored: false } },
});

export const fillPayslipWithLlm = defineRoute({
  id: "fill_payslip_with_llm",
  method: "POST",
  path: "/payroll/payslips/{id}/llm-fill",
  scope: "write",
  capability: "payroll",
  summary:
    "Asks the LLM fallback for the blank fields it may fill; what it fills is inferred and waits for a " +
    "decision. `unavailable` (`reason` `llm_not_configured`, `llm_failed`) when it cannot answer.",
  actions: ["fillWithLlmAction"],
  params: byPayslip,
  response: z.object({ asked: z.number().int(), filled: z.number().int() }),
  errors: [...PAYROLL_ERRORS, "unavailable"],
  example: { params: { id: DOCUMENT_ID }, response: { asked: 2, filled: 1 } },
});
