// A payslip typed by hand (rewrite plan R5g, decision ST-21): how a person whose payslips no profile
// reads uses Payroll. It is applied at once: it enters the register and the KPIs, and its pension
// fields reach the fund. The PDF is optional: upload it first with `POST /imports` (kind `payslip`)
// and, once it is read (`needs_review`), give its id here.
import { z } from "zod";
import { civilDate, id, money, monthStart } from "../primitives";
import { defineRoute } from "../route";
import {
  DOCUMENT_ID,
  MAX_EXTRA_PAYMENTS,
  PAYROLL_ERRORS,
  PAYSLIP_ID,
  PAYSLIP_KINDS,
  PAYSLIP_TYPES,
  payslipFieldValues,
} from "./shared";

const byManual = z.object({ id: id() });

const manualBody = z
  .object({
    kind: z.enum(PAYSLIP_KINDS),
    year: z.number().int().min(1990).max(2200),
    /** The month paid (1-12): required for `ordinary`, none for `extra`, optional otherwise. */
    month: z.number().int().min(1).max(12).nullable(),
    /** The extra payment's number, for `extra` only: 1 is the first (a 13th). */
    extraNumber: z.number().int().min(1).max(MAX_EXTRA_PAYMENTS).nullable(),
    paidOn: civilDate().nullable(),
    gross: money(),
    taxes: money(),
    contributions: money(),
    /** At most `gross`. */
    net: money(),
    /** Optional fields of the catalogue (`GET /payroll/fields`, not `base`), as pairs. */
    fields: payslipFieldValues().optional(),
    /** A payslip's document, read and not applied: it is applied with this payslip. */
    documentId: id().nullable().optional(),
  })
  .strict();

const manualPayslip = z.object({
  id: id(),
  year: z.number().int(),
  period: monthStart().nullable(),
  kind: z.enum(PAYSLIP_KINDS),
  extraNumber: z.number().int().nullable(),
  /** Deprecated (R5g): the old type, written beside the kind. */
  type: z.enum(PAYSLIP_TYPES),
  paidOn: civilDate().nullable(),
  gross: money().nullable(),
  taxes: money().nullable(),
  contributions: money().nullable(),
  net: money().nullable(),
  fields: payslipFieldValues(),
  document: z.object({ id: id(), fileName: z.string(), hasOriginal: z.boolean() }).nullable(),
});

const BODY_EXAMPLE = {
  kind: "ordinary",
  year: 2026,
  month: 3,
  extraNumber: null,
  paidOn: "2026-03-27",
  gross: "3000.00",
  taxes: "600.00",
  contributions: "280.00",
  net: "2100.00",
  fields: { irpefGross: "650.00" },
  documentId: DOCUMENT_ID,
};

const MANUAL_EXAMPLE = {
  id: PAYSLIP_ID,
  year: 2026,
  period: "2026-03-01",
  kind: "ordinary",
  extraNumber: null,
  type: "ordinary",
  paidOn: "2026-03-27",
  gross: "3000.00",
  taxes: "600.00",
  contributions: "280.00",
  net: "2100.00",
  fields: { irpefGross: "650.00" },
  document: { id: DOCUMENT_ID, fileName: "payslip-2026-03.pdf", hasOriginal: true },
};

const WRITE_SUMMARY =
  "`invalid` (`invalid_value`) for amounts that do not hold (a negative one, net over gross), a month or " +
  "an extra number the kind does not take, a field outside the catalogue; `conflict` (`month_applied`) when the " +
  "month — or the extra payment — of the year already has an applied payslip, (`conflict`) for a document " +
  "that already has a payslip or a write at the same time, (`invalid_state`) for a document still being read " +
  "or waiting for OCR. A refused payslip leaves its document as it was, in the inbox: send it again, or " +
  "delete the document with `DELETE /payroll/payslips/{id}`.";

export const createManualPayslip = defineRoute({
  id: "create_manual_payslip",
  method: "POST",
  path: "/payroll/manual-payslips",
  scope: "write",
  capability: "payroll",
  summary: `Types a payslip by hand; it is applied at once. ${WRITE_SUMMARY}`,
  actions: [],
  body: manualBody,
  response: manualPayslip,
  status: 201,
  errors: PAYROLL_ERRORS,
  example: { body: BODY_EXAMPLE, response: MANUAL_EXAMPLE },
});

export const getManualPayslip = defineRoute({
  id: "get_manual_payslip",
  method: "GET",
  path: "/payroll/manual-payslips/{id}",
  scope: "read",
  capability: "payroll",
  summary: "One payslip typed by hand, by its id (`payslipId` of the register).",
  actions: [],
  params: byManual,
  response: manualPayslip,
  errors: ["not_found"],
  example: { params: { id: PAYSLIP_ID }, response: MANUAL_EXAMPLE },
});

export const updateManualPayslip = defineRoute({
  id: "update_manual_payslip",
  method: "PUT",
  path: "/payroll/manual-payslips/{id}",
  scope: "write",
  capability: "payroll",
  summary:
    "Changes a payslip typed by hand, whole. Its document stays; one without a document may take one. " +
    WRITE_SUMMARY,
  actions: [],
  params: byManual,
  body: manualBody,
  response: manualPayslip,
  errors: PAYROLL_ERRORS,
  example: { params: { id: PAYSLIP_ID }, body: BODY_EXAMPLE, response: MANUAL_EXAMPLE },
});

export const deleteManualPayslip = defineRoute({
  id: "delete_manual_payslip",
  method: "DELETE",
  path: "/payroll/manual-payslips/{id}",
  scope: "write",
  capability: "payroll",
  summary: "Deletes a payslip typed by hand, with its document and original. `deletedDocument`: it had one.",
  actions: [],
  params: byManual,
  response: z.object({ deletedDocument: z.boolean() }),
  errors: PAYROLL_ERRORS,
  example: { params: { id: PAYSLIP_ID }, response: { deletedDocument: true } },
});
