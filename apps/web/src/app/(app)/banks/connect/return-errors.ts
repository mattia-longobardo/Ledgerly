// Why the return from the bank's site did not end with a connection (ux/n1-plugin-bank.md §6.3): the
// codes `/api/v1/plugins/{id}/callback` puts in the address, which the step of the bank says again.
const BANK_STEP_ERRORS = [
  "denied",
  "expired",
  "session",
  "no_accounts",
  "unreachable",
  "unreadable",
  "bank_unavailable",
] as const;

export type BankStepError = (typeof BANK_STEP_ERRORS)[number];

export const isBankStepError = (value: string | null): value is BankStepError =>
  BANK_STEP_ERRORS.some((code) => code === value);
