// tests/fixtures/cometa/samples.ts — invented Cometa documents that add up like the real ones
// (spec §11, D14), coherent with the payroll twins of 2031 (`tests/fixtures/payroll`).
//
// The payslips accrue, per month, 25,00 worker · 45,00 employer · 150,00 TFR, with 5,16 + 5,16 of
// enrolment in January and a 13th worth 5,00 of worker quota. The fund credits them a quarter at a
// time: I 2031 (three months), the enrolment apart, II 2031 (April only, over two compartments).
// The fourth quarter of 2031 is accrued and not yet due.
import type { TwinOperation, TwinPosition } from "./twin";

const EMPLOYER = { employerTaxCode: "01234567890", employerName: "ACME SPA" };
const QUOTED = { state: "QUOTATO", other: "0,00" };

/** I 2031: 75,00 + 135,00 + 450,00 = 660,00 gross, 3,00 of fees, 657,00 into 30 units at 21,900. */
export const FIRST_QUARTER: TwinOperation = {
  type: "Contributo",
  ...QUOTED,
  ...EMPLOYER,
  date: "18/04/2031",
  competence: "2031 PRIMO",
  worker: "75,00",
  employer: "135,00",
  tfr: "450,00",
  fees: "3,00",
  net: "657,00",
  movements: [{ compartment: "CRESCITA", units: "30,000", unitPrice: "21,900", unitPriceDate: "30/04/2031" }],
};

/** The enrolment: the export calls it "Contributo" too — net zero, no units, fees = the amounts. */
export const ENROLLMENT: TwinOperation = {
  type: "Contributo",
  ...QUOTED,
  ...EMPLOYER,
  date: "18/04/2031",
  competence: "2031 PRIMO",
  worker: "5,16",
  employer: "5,16",
  tfr: "0,00",
  fees: "10,32",
  net: "0,00",
  movements: [{ compartment: "CRESCITA", units: "0,000", unitPrice: "21,900", unitPriceDate: "30/04/2031" }],
};

/** II 2031: one operation, two compartments — the header amounts count once (GC §13). */
export const SECOND_QUARTER: TwinOperation = {
  type: "Contributo",
  ...QUOTED,
  ...EMPLOYER,
  date: "18/07/2031",
  competence: "2031 SECONDO",
  worker: "25,00",
  employer: "45,00",
  tfr: "150,00",
  fees: "3,00",
  net: "217,00",
  movements: [
    { compartment: "CRESCITA", units: "5,000", unitPrice: "21,700", unitPriceDate: "31/07/2031" },
    { compartment: "SICUREZZA", units: "5,000", unitPrice: "21,700", unitPriceDate: "31/07/2031" },
  ],
};

/** The export as of August 2031: everything credited so far. */
export const EXPORT_AUGUST: TwinOperation[] = [SECOND_QUARTER, FIRST_QUARTER, ENROLLMENT];

/** Capital from another fund: never a gain (GC §13). */
export const TRANSFER_IN: TwinOperation = {
  type: "Trasferimento in ingresso",
  ...QUOTED,
  ...EMPLOYER,
  date: "20/08/2031",
  competence: "",
  worker: "0,00",
  employer: "0,00",
  tfr: "0,00",
  other: "1.000,00",
  fees: "10,00",
  net: "990,00",
  movements: [{ compartment: "CRESCITA", units: "45,000", unitPrice: "22,000", unitPriceDate: "31/08/2031" }],
};

/** A compartment change: an internal movement, not new savings (GC §13). */
export const SWITCH: TwinOperation = {
  type: "Cambio comparto",
  ...QUOTED,
  ...EMPLOYER,
  date: "21/08/2031",
  competence: "",
  worker: "0,00",
  employer: "0,00",
  tfr: "0,00",
  other: "0,00",
  fees: "10,00",
  net: "0,00",
  movements: [
    { compartment: "CRESCITA", units: "-10,000", unitPrice: "22,000", unitPriceDate: "31/08/2031" },
    { compartment: "SICUREZZA", units: "10,000", unitPrice: "22,000", unitPriceDate: "31/08/2031" },
  ],
};

/** A documented advance: capital out of the position (GC §7, §9.3). */
export const WITHDRAWAL: TwinOperation = {
  type: "Anticipazione",
  ...QUOTED,
  ...EMPLOYER,
  date: "22/08/2031",
  competence: "",
  worker: "0,00",
  employer: "0,00",
  tfr: "0,00",
  other: "-200,00",
  fees: "10,00",
  net: "-210,00",
  movements: [{ compartment: "CRESCITA", units: "-9,545", unitPrice: "22,000", unitPriceDate: "31/08/2031" }],
};

/** A voluntary payment straight to the fund, outside payroll (GC §3.1). */
export const VOLUNTARY: TwinOperation = {
  type: "Versamento volontario",
  ...QUOTED,
  ...EMPLOYER,
  date: "05/08/2031",
  competence: "",
  worker: "100,00",
  employer: "0,00",
  tfr: "0,00",
  other: "0,00",
  fees: "0,00",
  net: "100,00",
  movements: [{ compartment: "CRESCITA", units: "4,545", unitPrice: "22,000", unitPriceDate: "31/08/2031" }],
};

/** The export with every other kind of operation, for the cases the real one does not carry. */
export const EXPORT_EXOTIC: TwinOperation[] = [TRANSFER_IN, SWITCH, WITHDRAWAL, VOLUNTARY];

/**
 * The position at 31/08/2031: inflows 890,32 = 660,00 + 10,32 + 220,00; fees 16,32; 874,00 into
 * units; value 950,00, so the reported gain is 59,68.
 */
export const POSITION_AUGUST: TwinPosition = {
  name: "ROSSI MARIA",
  valuationDate: "31/08/2031",
  value: "950,00",
  tfr: "600,00",
  worker: "105,16",
  employer: "185,16",
  transfers: "0,00",
  inflows: "890,32",
  advances: "0,00",
  redemptions: "0,00",
  rita: "0,00",
  outflows: "0,00",
  gain: "59,68",
};

/** An older statement: its date is what it speaks of, never today (GC §13 "snapshot vecchio"). */
export const POSITION_APRIL: TwinPosition = {
  ...POSITION_AUGUST,
  valuationDate: "30/04/2031",
  value: "670,00",
  tfr: "450,00",
  worker: "80,16",
  employer: "140,16",
  inflows: "670,32",
  gain: "-0,32",
};
