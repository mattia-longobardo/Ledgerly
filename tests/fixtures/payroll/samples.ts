// tests/fixtures/payroll/samples.ts — invented payslips that add up like real ones (spec §11, D14).
// Every number here is made up; the checks of spec §7.8 pass on each twin unless it says otherwise.
import type { TwinPayslip } from "./twin";

const EMPLOYER = "01234567890";

/**
 * March 2031, an ordinary month: 8 h of holiday (the 300/301 pair), the regional instalment, the
 * fund, TFR, a substitute tax printed twice. Net = 2000.00 − 35.00 − 183.80 − 267.73 − 2.50 − 0.40
 * + 0.43 = 1511.00.
 */
export const MARCH: TwinPayslip = {
  period: "MARZO 2031",
  employerCode: EMPLOYER,
  employeeCode: "901",
  employeeName: "ROSSI MARIA",
  printedOn: "27/03/31",
  contractual: "2000.00",
  lines: [
    { code: "2", description: "LAVORO ORDIN.(mens.)", quantity: "1.00", rate: "2000.00000", earnings: "2000.00" },
    { code: "300", description: "ASSENZA X FERIE A.C.(hh)", quantity: "8.00", rate: "-11.56069", earnings: "-92.49" },
    { code: "301", description: "FERIE A.C.(hh)", quantity: "8.00", rate: "11.56069", earnings: "92.49" },
    { code: "1150", description: "RATA ADD.REG. A.P.", deductions: "10.00" },
    { code: "7101", description: "FONDO C/DIPE", deductions: "25.00" },
    { code: "8003", description: "CONTRIBUZIONE TFR", statistical: "150.00" },
    { code: "9109", description: "FONDO C/AZIENDA", statistical: "45.00" },
    { code: "9110", description: "COMUNICAZIONE DIPENDENTE", statistical: "25.00" },
    { code: "9838", description: "IMPOSTA SOST. 5% L.199/25", statistical: "2.50" },
  ],
  totalGross: "2000.00",
  social: "183.80",
  substituteSummary: "2.50",
  oneri: "60.00",
  irpefTaxable: "1816.20",
  irpefGross: "417.73",
  taxDeductions: "150.00",
  irpefWithheld: "267.73",
  roundingPrevious: "0.40",
  bodyDeductions: "35.00",
  totalDeductions: "489.43",
  roundingCurrent: "0.43",
  net: "1511.00",
  vacation: ["5.00", "40.00", null, "45.00"],
  rol: ["10.00", "20.00", null, "30.00"],
  // Different numbers under the same labels further down: the month's boxes must win.
  progressives: { taxable: "5448.60", irpefGross: "1253.19", deductions: "450.00", paid: "803.19" },
};

/**
 * April 2031: 4 h of permit (the 308/309 pair) that the ROL balance confirms — March left 30.00,
 * 6.66 more accrued, 4 used: 32.66. Net = 2000.00 − 35.00 − 183.80 − 267.73 − 0.43 + 0.96 = 1514.00.
 */
export const APRIL: TwinPayslip = {
  ...MARCH,
  period: "APRILE 2031",
  printedOn: "28/04/31",
  lines: [
    { code: "2", description: "LAVORO ORDIN.(mens.)", quantity: "1.00", rate: "2000.00000", earnings: "2000.00" },
    { code: "308", description: "ASSENZA X PERM. A.C.(hh)", quantity: "4.00", rate: "-11.56069", earnings: "-46.24" },
    { code: "309", description: "PERMESSI A.C.(hh)", quantity: "4.00", rate: "11.56069", earnings: "46.24" },
    { code: "1150", description: "RATA ADD.REG. A.P.", deductions: "10.00" },
    { code: "7101", description: "FONDO C/DIPE", deductions: "25.00" },
    { code: "8003", description: "CONTRIBUZIONE TFR", statistical: "150.00" },
    { code: "9109", description: "FONDO C/AZIENDA", statistical: "45.00" },
  ],
  substituteSummary: undefined,
  roundingPrevious: "0.43",
  totalDeductions: "486.96",
  roundingCurrent: "0.96",
  net: "1514.00",
  vacation: ["5.00", "46.66", null, "51.66"],
  rol: ["6.00", "26.66", null, "32.66"],
  progressives: undefined,
};

/**
 * The 13th of 2031: its own type, no month, the employee fund adjusted (−20.00) and the employer's
 * adjustment alone (−30.00). Net = 500.00 − 5.00 − 45.95 − 104.43 − 0.43 + 0.81 = 345.00.
 */
export const THIRTEENTH: TwinPayslip = {
  ...MARCH,
  period: "13a MENS. 2031",
  printedOn: "12/12/31",
  lines: [
    { code: "901", description: "13^ MENSILITA'(hh)", quantity: "43.25", rate: "11.56069", earnings: "500.00" },
    { code: "7101", description: "FONDO C/DIPE", deductions: "25.00" },
    { code: "8054", description: "CONTRIBUTO DIPENDENTE", deductions: "-20.00" },
    { code: "8056", description: "CONTRIBUZIONE C/AZIENDA", statistical: "-30.00" },
  ],
  totalGross: "500.00",
  social: "45.95",
  substituteSummary: undefined,
  oneri: undefined,
  irpefTaxable: "454.05",
  irpefGross: "104.43",
  taxDeductions: undefined,
  irpefWithheld: "104.43",
  roundingPrevious: "0.43",
  bodyDeductions: "5.00",
  totalDeductions: "155.81",
  roundingCurrent: "0.81",
  net: "345.00",
  progressives: undefined,
};

/** March again, reprinted with a later date: the same logical key, another file — a rectification. */
export const MARCH_REPRINT: TwinPayslip = { ...MARCH, printedOn: "02/04/31" };

/** March with a code no profile knows: the payslip waits for review. */
export const MARCH_UNKNOWN_CODE: TwinPayslip = {
  ...MARCH,
  printedOn: "29/03/31",
  lines: [...MARCH.lines, { code: "5555", description: "VOCE SCONOSCIUTA", statistical: "1.00" }],
};
