import { LEAVE_ROLES } from "./legacy";

export const LINE_UNITS = ["hours", "days", "months"] as const;
export type LineUnit = (typeof LINE_UNITS)[number];

/**
 * What a body code means (spec §7.8 "Mappa dei codici"; owner's spec L91–161). A role either feeds
 * one field (`ROLE_FIELD`), produces leave events (the roles of a profile's balances), or is kept as
 * a raw line only.
 */
export const CODE_ROLES = [
  "ordinary_earnings",
  "thirteenth_earnings",
  "holiday_pay",
  "absence",
  "paid_leave",
  ...LEAVE_ROLES,
  "separate_payment",
  "refund_730",
  "regional_installment",
  "municipal_installment",
  "substitute_tax",
  "substitute_tax_base",
  "employee_fund",
  "employee_fund_adjustment",
  "employee_fund_enrollment",
  "employer_fund",
  "employer_fund_adjustment",
  "employer_fund_enrollment",
  "tfr_contribution",
  "tfr_exemption",
  "welfare_cash",
  "welfare_in_kind",
  "compensated_credit",
  "statistical",
  "other",
] as const;
export type CodeRole = (typeof CODE_ROLES)[number];
