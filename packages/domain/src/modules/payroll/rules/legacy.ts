// The stored words of leave from before the payslip profiles were data (rewrite plan R5g, E1). Rows,
// their checks and the wire still carry them, so they stay until the leave of payroll moves to the
// types of leave; R5f drops them. A profile names its balances with these words (its data); this
// file is the one place in the code of payroll that writes them.

/** The balances a payslip prints, as stored on a leave event and a balance snapshot. */
export const LEAVE_KINDS = ["vacation", "rol", "permit"] as const;
export type LeaveKind = (typeof LEAVE_KINDS)[number];

/** The code roles of leave lines: the absence and the paid leave of the same entry. */
export const LEAVE_ROLES = ["vacation_offset", "vacation_event", "permit_offset", "permit_event"] as const;

/** The warning of a use of leave that no balance confirms. */
export const UNCONFIRMED_LEAVE = "permit_unclassified";

/**
 * The type a profile reads from a payslip's heading (a 13th, a 14th…): the reader's word, turned
 * into a kind and an extra payment's number before anything is stored (R5f dropped the column).
 */
export const PAYSLIP_TYPES = ["ordinary", "thirteenth", "fourteenth", "fifteenth", "bonus", "settlement"] as const;
export type PayslipType = (typeof PAYSLIP_TYPES)[number];

/** The old types of the first, second and third extra payment: the only ones the old type has. */
const EXTRA_TYPES = ["thirteenth", "fourteenth", "fifteenth"] as const;
/** The old types that are a kind of their own. */
const KIND_TYPES = ["ordinary", "bonus", "settlement"] as const;

/** The kind and the extra payment's number an old type stands for. */
export function kindOfType(type: string): { kind: "ordinary" | "extra" | "bonus" | "settlement"; extraNumber: number | null } {
  const index = EXTRA_TYPES.findIndex((one) => one === type);
  if (index >= 0) return { kind: "extra", extraNumber: index + 1 };
  return { kind: KIND_TYPES.find((one) => one === type) ?? "ordinary", extraNumber: null };
}
