/**
 * Pure rules of the transactions module (spec §7.2). T3 fills in the functions; the constants
 * below are the vocabulary `schema.ts` builds its columns and checks on.
 */

export const TRANSACTION_TYPES = ["income", "expense", "transfer"] as const;
export const TRANSACTION_STATES = ["cleared", "pending"] as const;
export const CATEGORY_TYPES = ["income", "expense", "transfer"] as const;

export type TransactionType = (typeof TRANSACTION_TYPES)[number];
export type TransactionState = (typeof TRANSACTION_STATES)[number];
export type CategoryType = (typeof CATEGORY_TYPES)[number];

/** The fields a user can own locally; everything else belongs to the provider (spec §7.2). */
export const EDITABLE_FIELDS = ["categoryId", "note", "labels"] as const;

export type EditableField = (typeof EDITABLE_FIELDS)[number];

/** Recurrence interval bands, in days (spec §7.2). */
export const RECURRENCE_BANDS = [
  { cadence: "weekly", min: 5, max: 9 },
  { cadence: "biweekly", min: 12, max: 16 },
  { cadence: "monthly", min: 26, max: 34 },
  { cadence: "quarterly", min: 80, max: 100 },
  { cadence: "yearly", min: 350, max: 380 },
] as const;

export type Cadence = (typeof RECURRENCE_BANDS)[number]["cadence"];

/** At least this many occurrences before a payee counts as recurring (spec §7.2). */
export const RECURRENCE_MIN_OCCURRENCES = 3;

/** How far each amount may sit from the median and still belong to the pattern (spec §7.2). */
export const RECURRENCE_AMOUNT_TOLERANCE = 0.1;
