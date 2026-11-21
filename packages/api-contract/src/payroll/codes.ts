// The code map of Payroll › Settings (rewrite plan R2, 05-refactor.md §5.5 «payroll»; PAY-8): what
// each body code of a payslip means. Payslips read after a change use it.
import { z } from "zod";
import { defineRoute } from "../route";
import { byCode, CODE_ROLES, MAX_CODE_NOTE, PAYROLL_ERRORS } from "./shared";

const codeEntry = z.object({
  code: z.string(),
  role: z.enum(CODE_ROLES),
  note: z.string().nullable(),
  /** The code comes with the reading profile: «Reset» puts it back, instead of removing it. */
  seeded: z.boolean(),
});

export const listPayrollCodes = defineRoute({
  id: "list_payroll_codes",
  method: "GET",
  path: "/payroll/codes",
  scope: "read",
  capability: "payroll",
  summary: "The code map: what each body code means, the profile's codes and the person's own.",
  actions: [],
  response: z.object({ codes: z.array(codeEntry) }),
  errors: [],
  example: { response: { codes: [{ code: "1000", role: "ordinary_earnings", note: null, seeded: true }] } },
});

export const setPayrollCode = defineRoute({
  id: "set_payroll_code",
  method: "PUT",
  path: "/payroll/codes/{code}",
  scope: "write",
  capability: "payroll",
  summary: "Sets what a code means; a code the map lacked is added.",
  actions: [],
  params: byCode,
  body: z.object({ role: z.enum(CODE_ROLES), note: z.string().max(MAX_CODE_NOTE).nullable() }).strict(),
  response: null,
  status: 204,
  errors: PAYROLL_ERRORS,
  example: { params: { code: "5555" }, body: { role: "other", note: null } },
});

export const resetPayrollCode = defineRoute({
  id: "reset_payroll_code",
  method: "DELETE",
  path: "/payroll/codes/{code}",
  scope: "write",
  capability: "payroll",
  summary: "Puts a code back to what the profile says, or removes a code the profile does not have.",
  actions: [],
  params: byCode,
  response: null,
  status: 204,
  errors: PAYROLL_ERRORS,
  example: { params: { code: "5555" } },
});
