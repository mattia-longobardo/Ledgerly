/**
 * Budget Makers Wallet transactions and categories, mapped into this app's
 * vocabulary.
 *
 * The only file in this module that knows Wallet's own field names. Everything
 * downstream — `syncProviderTransactions`, the repositories, the UI — speaks
 * `ProviderTransaction`/`ProviderCategory`, never a Wallet field directly.
 */

import { getCategories, getRecords, type WalletCategory, type WalletRecord } from "@/lib/clients/wallet";
import type { ProviderCategory, ProviderTransaction, TransactionsSource } from "../application/ports";
import type { CategoryKind, TransactionState, TransactionType } from "../domain/transaction";

export const WALLET_PROVIDER = "wallet";

const INCOME_HINTS = ["salary", "income", "refund", "interest", "dividend", "bonus"];

function categoryKind(raw: WalletCategory): CategoryKind {
  if (raw.isIncome) return "income";
  const name = raw.name.toLowerCase();
  return INCOME_HINTS.some((hint) => name.includes(hint)) ? "income" : "expense";
}

function transactionType(raw: WalletRecord): TransactionType {
  const t = (raw.recordType ?? "").toLowerCase();
  if (t === "transfer") return "transfer";
  if (t === "income") return "income";
  if (t === "expense") return "expense";
  return raw.amount >= 0 ? "income" : "expense";
}

function transactionState(raw: WalletRecord): TransactionState {
  const s = (raw.recordState ?? "").toLowerCase();
  if (s === "pending") return "pending";
  if (s === "reconciled") return "reconciled";
  return "cleared";
}

export function mapWalletCategory(raw: WalletCategory): ProviderCategory {
  return { externalId: raw.id, name: raw.name.trim(), groupName: raw.group ?? null, kind: categoryKind(raw) };
}

export function mapWalletRecord(raw: WalletRecord): ProviderTransaction {
  return {
    externalId: raw.id,
    accountExternalId: raw.accountId,
    occurredAt: new Date(raw.recordDate),
    amount: raw.amount.toFixed(2),
    currency: raw.currencyCode.toUpperCase(),
    type: transactionType(raw),
    state: transactionState(raw),
    payee: raw.partyName?.trim() || null,
    note: raw.note?.trim() || null,
    categoryExternalId: raw.categoryId ?? null,
    labelExternalIds: raw.labels ?? [],
    externalTransferRef: raw.transferCounterRecordId ?? null,
    updatedAt: raw.updatedAt ? new Date(raw.updatedAt) : null,
  };
}

/**
 * `token` is passed in, never read here: the credential lives in the
 * encrypted vault (Phase 2) and is resolved by the sync engine's `fetch`
 * phase, which carries no database handle.
 */
export function walletTransactionsSource(token: string): TransactionsSource {
  return {
    provider: WALLET_PROVIDER,
    async fetchTransactions(sinceDate) {
      const raw = await getRecords({ token, sinceDate: sinceDate ?? undefined });
      return raw.map(mapWalletRecord);
    },
    async fetchCategories() {
      const raw = await getCategories({ token });
      return raw.map(mapWalletCategory);
    },
  };
}

/** An already-fetched source, for the sync engine's `apply` phase, which has the rows but no credential. */
export function prefetchedWalletTransactionsSource(
  transactions: readonly ProviderTransaction[],
  categories: readonly ProviderCategory[],
): TransactionsSource {
  return {
    provider: WALLET_PROVIDER,
    fetchTransactions: async () => [...transactions],
    fetchCategories: async () => [...categories],
  };
}
