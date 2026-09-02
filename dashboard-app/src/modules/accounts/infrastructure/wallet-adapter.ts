/**
 * The only place that knows what a Budget Makers Wallet account looks like.
 *
 * Everything downstream — the sync use case, the repositories, the UI — speaks
 * `ProviderAccount`. Keeping the provider's field names penned in here is what
 * lets a second provider land later without a rewrite: it brings its own
 * adapter and nothing else changes.
 */

import { getAccounts, type WalletAccount } from "@/lib/clients/wallet";
import { romeDate } from "@/lib/time";
import type { AccountsSource, Clock, ProviderAccount } from "../application/ports";
import type { AccountType } from "../domain/account";

export const WALLET_PROVIDER = "wallet";

/**
 * Wallet's own vocabulary, lower-cased so a casing change upstream is not a
 * silent demotion to `other`. `Saving` and `Savings` both occur in the live
 * payload, which is why both are listed.
 */
const TYPE_BY_ACCOUNT_TYPE: Record<string, AccountType> = {
  cash: "cash",
  general: "checking",
  checking: "checking",
  current: "checking",
  saving: "savings",
  savings: "savings",
  investment: "investment",
  "credit card": "credit",
  crypto: "crypto",
};

/**
 * A named type wins; the investment flag only decides what an otherwise
 * unrecognised account becomes, so a "Cash" account that happens to carry the
 * flag stays cash.
 */
function accountType(raw: WalletAccount): AccountType {
  const named = TYPE_BY_ACCOUNT_TYPE[(raw.accountType ?? "").trim().toLowerCase()];
  if (named) return named;
  return raw.isInvestmentAccount ? "investment" : "other";
}

function updatedAt(raw: WalletAccount): Date | null {
  if (!raw.updatedAt) return null;
  const parsed = new Date(raw.updatedAt);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * `asOf` is passed in rather than derived here: the Wallet API returns a
 * current balance with no date of its own, so the date is the moment of the
 * fetch and every account in one pass has to share it.
 */
export function mapWalletAccount(raw: WalletAccount, asOf: string): ProviderAccount {
  return {
    externalId: raw.id,
    name: raw.name.trim(),
    type: accountType(raw),
    currency: raw.currencyCode.toUpperCase(),
    archived: raw.archived,
    balance: raw.balance.currentBalance.toFixed(2),
    // Wallet exposes no separate available figure.
    available: null,
    asOf,
    updatedAt: updatedAt(raw),
  };
}

export function walletAccountsSource(clock: Clock): AccountsSource {
  return {
    provider: WALLET_PROVIDER,
    async fetchAccounts(): Promise<ProviderAccount[]> {
      const asOf = romeDate(clock.now());
      const raw = await getAccounts();
      return raw.map((a) => mapWalletAccount(a, asOf));
    },
  };
}
