// The rules of a country as data (rewrite plan, 10-modularity.md §10.11, extension point E4). Italy
// is the one pack today; R5a proposes a pack's defaults at the first start, and R5g adds the
// types of leave. A module takes its rule as a value: no country is written in its
// code. A country without a pack has no rules: its fields stay empty (D3).

/** The countries with a pack of rules. */
export const COUNTRIES = ["IT"] as const;
type Country = (typeof COUNTRIES)[number];

/**
 * A type of leave a pack proposes (R5g, E6): the first types of a person of the country, which
 * they rename, change or remove. `balanceKey` is the word a payslip of the country prints its
 * balance under; `calendarKind` the word an external calendar holds its days under.
 */
interface PackLeaveType {
  names: { en: string; it: string };
  color: "primary" | "warn" | "accent" | "neg" | "faint" | "pos" | "muted";
  unit: "day" | "half_day" | "hours";
  hasAllowance: boolean;
  toCalendar: boolean;
  balanceKey: string | null;
  calendarKind: string | null;
}

/**
 * A field a payslip of the country carries beyond the base ones (R5g, E4): stored as a key-value pair
 * of the payslip. `key` is the payroll field it is; `summed`: a column of the register, summed per
 * year and averaged per ordinary month.
 */
interface PackPayslipField {
  key: string;
  group: "compensation" | "taxes" | "contributions" | "tfr" | "net";
  summed: boolean;
}

interface CountryRules {
  /** The tax withheld on interest, in percent, that a new interest rule proposes. */
  interestTaxPercent: string;
  /** What the first start proposes for a person of the country. */
  currency: string;
  timeZone: string;
  numberFormat: "it-IT" | "en-US" | "fr-FR";
  locale: "en" | "it";
  weekStart: 0 | 1;
  /** The types of leave a person of the country starts with, in their order (decision H20: no sickness). */
  leaveTypes: readonly PackLeaveType[];
  /** The fields of the country's payslips, in the order the register and the review show them. */
  payslipFields: readonly PackPayslipField[];
}

const field = (group: PackPayslipField["group"], keys: string, summed = ""): PackPayslipField[] =>
  keys.split(" ").map((key) => ({ key, group, summed: summed.split(" ").includes(key) }));

const RULES: Record<Country, CountryRules> = {
  IT: {
    interestTaxPercent: "26",
    currency: "EUR",
    timeZone: "Europe/Rome",
    numberFormat: "it-IT",
    locale: "it",
    weekStart: 1,
    leaveTypes: [
      {
        names: { en: "Vacation", it: "Ferie" },
        color: "primary",
        unit: "half_day",
        hasAllowance: true,
        toCalendar: true,
        balanceKey: "vacation",
        calendarKind: "vacation",
      },
      {
        names: { en: "ROL and permits", it: "ROL e permessi" },
        color: "warn",
        unit: "half_day",
        hasAllowance: true,
        toCalendar: true,
        balanceKey: "rol",
        calendarKind: null,
      },
    ],
    payslipFields: [
      ...field(
        "compensation",
        "contractualGross ordinaryEarnings totalGrossPrinted welfareCash welfareInKind",
        "welfareCash",
      ),
      ...field(
        "taxes",
        "irpefTaxable irpefGross taxDeductions irpefWithheld yearEndAdjustment regionalInstallment municipalWithheld " +
          "substituteTax refund730 compensatedCredit taxesNetOfRefunds",
        "irpefGross taxDeductions regionalInstallment substituteTax refund730",
      ),
      ...field(
        "contributions",
        "employeeFundRegular employeeFundAdjustments employeeFundEnrollment employeeFundEffective employerFundPrinted " +
          "employerFundAdjustments employerFundEnrollment employerFundEffective employerSocialTotal",
        "employeeFundEffective employerFundEffective",
      ),
      ...field("tfr", "tfrMonthField tfrContributionLine tfrSelected", "tfrSelected"),
      ...field(
        "net",
        "bodyEarnings bodyDeductions bodyDeductionsPrinted totalDeductionsPrinted roundingPrevious roundingCurrent",
      ),
    ],
  },
};

/** Whether `country` has a pack of rules. */
export function hasPack(country: string | null): country is Country {
  return COUNTRIES.some((one) => one === country);
}

/** Every rule of a country with a pack. */
export function countryRules(country: Country): Readonly<CountryRules> {
  return RULES[country];
}
