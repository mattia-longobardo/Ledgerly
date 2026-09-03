import type { AccountStatus, AccountType } from "../domain/account";

export const ACCOUNT_TYPE_LABEL: Record<AccountType, string> = {
  checking: "Checking",
  savings: "Savings",
  cash: "Cash",
  investment: "Investment",
  pension_fund: "Pension fund",
  crypto: "Crypto",
  credit: "Credit",
  other: "Other",
};

export const ACCOUNT_TYPE_OPTIONS = Object.entries(ACCOUNT_TYPE_LABEL) as [
  AccountType,
  string,
][];

export const ACCOUNT_STATUS_LABEL: Record<AccountStatus, string> = {
  active: "Active",
  unavailable: "Unavailable",
  archived: "Archived",
};

export const WALLET_ORIGIN_LABEL = "Synced from Budget Makers Wallet";
export const MANUAL_ORIGIN_LABEL = "Manual";
