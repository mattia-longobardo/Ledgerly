export interface ScopeLike {
  kind: "account" | "category" | "label" | "fund";
  refId: string;
}

export interface TransactionLike {
  id: string;
  accountId: string;
  categoryId: string | null;
  labelIds: readonly string[];
  type: "income" | "expense" | "transfer";
  amount: string;
  occurredAt: string;
}

function scopeMatchesOne(scope: ScopeLike, tx: TransactionLike): boolean {
  switch (scope.kind) {
    case "account":
      return tx.accountId === scope.refId;
    case "category":
      return tx.categoryId === scope.refId;
    case "label":
      return tx.labelIds.includes(scope.refId);
    case "fund":
      return false;
  }
}

/** True when any account/category/label scope matches; a 'fund' scope never matches a transaction. */
export function scopeMatches(scopes: readonly ScopeLike[], tx: TransactionLike): boolean {
  return scopes.some((scope) => scopeMatchesOne(scope, tx));
}

const DECIMAL_RE = /^(-?)(\d+)(?:\.(\d+))?$/;

function cents(value: string): bigint {
  const match = DECIMAL_RE.exec(value.trim());
  if (!match) throw new Error(`not a decimal: ${value}`);
  const [, sign, integer, fraction = ""] = match;
  return BigInt(`${sign}${integer}${(fraction + "00").slice(0, 2)}`);
}

function formatCents(value: bigint): string {
  const negative = value < 0n;
  const absolute = (negative ? -value : value).toString().padStart(3, "0");
  return `${negative ? "-" : ""}${absolute.slice(0, -2)}.${absolute.slice(-2)}`;
}

/** |amount| for expenses, null otherwise (income and transfer never count as usage). */
export function usageAmount(tx: TransactionLike): string | null {
  if (tx.type !== "expense") return null;
  const value = cents(tx.amount);
  return formatCents(value < 0n ? -value : value);
}
