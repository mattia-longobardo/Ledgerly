/**
 * Wallet's accounts in the contract's words. Wallet publishes the balance inside the account, so
 * one read of `/accounts` gives both; it publishes no available balance apart.
 */
import type { SourceAccountsResponse } from "@ledgerly/plugin-contract";
import { assertWholePage } from "./guards";
import { read, type Wallet } from "./http";
import { centsToDecimal, walletAmountToCents } from "./money";
import { optionalText, type WalletAccountPayload, walletAccountsPayloadSchema } from "./payloads";

type AccountType = SourceAccountsResponse["accounts"][number]["type"];

/** The API's own ceiling on a list; `/accounts` is read in one page. */
const ACCOUNTS_LIMIT = 200;
const IDENTIFIER_MAX = 64;

/**
 * Wallet's account types, lower-cased and without spaces so a casing change upstream is not a
 * silent demotion to `other`. The Wallet API 2.0.0 enum first, then the older words some accounts
 * may still answer with. Loans, mortgages and overdrafts are money owed: `credit`. `Bonus` and
 * `Insurance` have no counterpart and stay `other`.
 */
const TYPE_BY_WALLET_TYPE: Record<string, AccountType> = {
  general: "checking",
  cash: "cash",
  currentaccount: "checking",
  creditcard: "credit",
  savingaccount: "savings",
  investment: "investment",
  loan: "credit",
  mortgage: "credit",
  overdraft: "credit",
  checking: "checking",
  current: "checking",
  saving: "savings",
  savings: "savings",
  crypto: "crypto",
};

/** A named type always wins; the investment flag only decides an otherwise unknown account. */
function walletAccountType(
  raw: Pick<WalletAccountPayload, "accountType" | "isInvestmentAccount">,
): AccountType {
  const word = (raw.accountType ?? "").replace(/\s+/g, "").toLowerCase();
  if (Object.hasOwn(TYPE_BY_WALLET_TYPE, word)) return TYPE_BY_WALLET_TYPE[word];
  return raw.isInvestmentAccount === true ? "investment" : "other";
}

/** The account number as Wallet stores it, unchecked: the core keeps it only when it is an IBAN. */
function identifierOf(raw: WalletAccountPayload): string | null {
  const text = optionalText(raw.bankAccountNumber);
  return text !== null && text.length <= IDENTIFIER_MAX ? text : null;
}

export async function readAccounts(wallet: Wallet): Promise<SourceAccountsResponse> {
  const accounts = await read(wallet, `/accounts?limit=${ACCOUNTS_LIMIT}`, walletAccountsPayloadSchema);
  assertWholePage("accounts", accounts.length, ACCOUNTS_LIMIT);
  return {
    accounts: accounts.map((raw) => ({
      externalId: raw.id,
      name: raw.name.trim(),
      type: walletAccountType(raw),
      currency: raw.currencyCode.trim().toUpperCase(),
      archived: raw.archived,
      identifier: identifierOf(raw),
      balance: centsToDecimal(walletAmountToCents(raw.balance.currentBalance)),
      available: null,
    })),
  };
}
