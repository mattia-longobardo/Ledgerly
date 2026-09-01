import type { AccountKey } from "@/lib/contracts";

export interface WalletAccountConfig {
  key: Extract<AccountKey, "ing" | "revolut_main" | "revolut_savings" | "revolut_holidays">;
  /** Exact `name` as it appears in the Wallet app — matched case-insensitively. */
  accountName: string;
  label: string;
  required: boolean;
}

/**
 * Names live here, not inline in the client: BudgetBakers is an unofficial API
 * and a renamed account must be a one-line config change.
 *
 * Names confirmed against the live API on 2026-09-01, once the token started
 * working again: the salary account is `ING - Salary`, not `ING` as PLAN.md
 * §3.2 assumed — an exact-name mismatch would have failed the whole snapshot
 * read, since a missing required account is fatal by design (§5, phase 1).
 * `Savings` is the interest account (not `Saving`).
 */
export const WALLET_ACCOUNTS: readonly WalletAccountConfig[] = [
  { key: "ing", accountName: "ING - Salary", label: "ING", required: true },
  { key: "revolut_main", accountName: "Revolut", label: "Revolut", required: true },
  { key: "revolut_savings", accountName: "Savings", label: "Revolut Savings", required: true },
  { key: "revolut_holidays", accountName: "Holidays", label: "Revolut Holidays", required: true },
];

/** Revolut on the dashboard is the sum of these three sub-accounts. */
export const REVOLUT_COMPONENT_KEYS = [
  "revolut_main",
  "revolut_savings",
  "revolut_holidays",
] as const;

export const WALLET_EXPECTED_CURRENCY = "EUR";
