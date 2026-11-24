// The columns of a payslip from before its kinds and its fields became data (rewrite plan R5g, E4
// and E6). They stay, and stay written beside `kind`, `extra_number` and the pairs of
// `payslip_fields`, so the image before R5g still reads true payslips: R5f drops them with their
// checks.
import { sql } from "drizzle-orm";
import { type AnyPgColumn, bigint, check, text } from "drizzle-orm/pg-core";
import { inList } from "../../../platform/db/checks";
import { PAYSLIP_TYPES, TFR_SOURCES } from "../rules";

const money = (name: string) => bigint(name, { mode: "bigint" });

/** The old type of a payslip, spread into its table. */
export function legacyTypeColumn() {
  return { type: text("type", { enum: PAYSLIP_TYPES }).notNull() };
}

/** The fields of the Italian pack as fixed columns: each one is a pair of `payslip_fields` too. */
export function legacyFieldColumns() {
  return {
    contractualGross: money("contractual_gross"),
    ordinaryEarnings: money("ordinary_earnings"),
    totalGrossPrinted: money("total_gross_printed"),
    welfareCash: money("welfare_cash"),
    welfareInKind: money("welfare_in_kind"),

    irpefTaxable: money("irpef_taxable"),
    irpefGross: money("irpef_gross"),
    taxDeductions: money("tax_deductions"),
    irpefWithheld: money("irpef_withheld"),
    yearEndAdjustment: money("year_end_adjustment"),
    regionalInstallment: money("regional_installment"),
    municipalWithheld: money("municipal_withheld"),
    substituteTax: money("substitute_tax"),
    refund730: money("refund_730"),
    compensatedCredit: money("compensated_credit"),
    taxesNetOfRefunds: money("taxes_net_of_refunds"),

    employeeFundRegular: money("employee_fund_regular"),
    employeeFundAdjustments: money("employee_fund_adjustments"),
    employeeFundEnrollment: money("employee_fund_enrollment"),
    employeeFundEffective: money("employee_fund_effective"),
    employerFundPrinted: money("employer_fund_printed"),
    employerFundAdjustments: money("employer_fund_adjustments"),
    employerFundEnrollment: money("employer_fund_enrollment"),
    employerFundEffective: money("employer_fund_effective"),
    employerSocialTotal: money("employer_social_total"),

    tfrMonthField: money("tfr_month_field"),
    tfrContributionLine: money("tfr_contribution_line"),
    tfrSelected: money("tfr_selected"),
    tfrSource: text("tfr_source", { enum: TFR_SOURCES }),

    bodyEarnings: money("body_earnings"),
    bodyDeductions: money("body_deductions"),
    bodyDeductionsPrinted: money("body_deductions_printed"),
    totalDeductionsPrinted: money("total_deductions_printed"),
    roundingPrevious: money("rounding_previous"),
    roundingCurrent: money("rounding_current"),
  };
}

/** The old constraints of `payslips`, kept as they are. */
export function legacyPayslipChecks(table: { type: AnyPgColumn; period: AnyPgColumn; tfrSource: AnyPgColumn }) {
  return [
    check("payslips_type_ck", sql`${table.type} in (${sql.raw(inList(PAYSLIP_TYPES))})`),
    check(
      "payslips_tfr_source_ck",
      sql`${table.tfrSource} is null or ${table.tfrSource} in (${sql.raw(inList(TFR_SOURCES))})`,
    ),
    // An ordinary payslip has its month; a 13th, 14th or 15th has none to invent (owner's spec L37).
    check(
      "payslips_period_type_ck",
      sql`(${table.type} <> 'ordinary' or ${table.period} is not null) and (${table.type} not in ('thirteenth', 'fourteenth', 'fifteenth') or ${table.period} is null)`,
    ),
  ];
}
