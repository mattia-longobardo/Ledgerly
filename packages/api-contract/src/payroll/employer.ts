// How a person's employer pays, and the fields their payslips carry (rewrite plan R5g, E4 and E6):
// what the screens of Payroll configure and offer, for a person with or without a reading profile.
import { z } from "zod";
import { defineRoute } from "../route";
import { FIELD_GROUPS, MAX_EXTRA_PAYMENTS, PAY_FREQUENCIES, PAYROLL_ERRORS } from "./shared";

const employerBody = z
  .object({
    payFrequency: z.enum(PAY_FREQUENCIES),
    /** The month (1-12) of each extra payment, in order: the first is a 13th, the second a 14th… */
    extraMonths: z.array(z.number().int().min(1).max(12)).max(MAX_EXTRA_PAYMENTS),
  })
  .strict();

const employer = employerBody.extend({
  /** False: the person never said, and these are the defaults (monthly, one extra payment in December). */
  configured: z.boolean(),
});

const EMPLOYER_EXAMPLE = { payFrequency: "monthly", extraMonths: [12], configured: true };

export const getPayrollEmployer = defineRoute({
  id: "get_payroll_employer",
  method: "GET",
  path: "/payroll/employer",
  scope: "read",
  capability: "payroll",
  summary:
    "How the employer pays: the frequency and the month of each extra payment. The yearly gross (RAL) " +
    "expects every extra payment listed here.",
  actions: [],
  response: employer,
  errors: [],
  example: { response: EMPLOYER_EXAMPLE },
});

export const setPayrollEmployer = defineRoute({
  id: "set_payroll_employer",
  method: "PUT",
  path: "/payroll/employer",
  scope: "write",
  capability: "payroll",
  summary: `Saves how the employer pays; at most ${MAX_EXTRA_PAYMENTS} extra payments.`,
  actions: [],
  body: employerBody,
  response: employer,
  errors: PAYROLL_ERRORS,
  example: { body: { payFrequency: "monthly", extraMonths: [12, 6] }, response: { ...EMPLOYER_EXAMPLE, extraMonths: [12, 6] } },
});

const catalogueField = z.object({
  /** The field's key: its name in `amounts`, in a payslip's `fields` and in the review. */
  key: z.string(),
  group: z.enum(FIELD_GROUPS),
  /** A field of every payslip: `gross`, `taxesTotal`, `employeeSocial`, `netPay`. */
  base: z.boolean(),
  /** A column of the register, summed per year and averaged per ordinary month. */
  summed: z.boolean(),
});

export const listPayslipFields = defineRoute({
  id: "list_payslip_fields",
  method: "GET",
  path: "/payroll/fields",
  scope: "read",
  capability: "payroll",
  summary:
    "The catalogue of the person's payslips: the base fields, then the fields of their country's pack " +
    "(none without a country). Every field is an amount.",
  actions: [],
  response: z.object({ fields: z.array(catalogueField) }),
  errors: [],
  example: {
    response: {
      fields: [
        { key: "gross", group: "compensation", base: true, summed: true },
        { key: "irpefGross", group: "taxes", base: false, summed: true },
      ],
    },
  },
});
