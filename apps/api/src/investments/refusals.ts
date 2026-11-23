// Investments · how a use case's refusal becomes the contract's, and the canonical numbers of a body
// as the domain takes them: shared by every route file of the module.
import { AccountError } from "@ledgerly/domain/accounts";
import { InvestmentError, SyncError } from "@ledgerly/domain/investments";
import { parseCents, parseDecimal } from "@ledgerly/domain/shared/money";
import { ApiRefusal } from "../serve";

/** The refusals of the caller's input (`INVESTMENT_REFUSALS`): every other one is a conflict. */
const INVALID = new Set([
  "future_date",
  "before_period",
  "invalid_transaction",
  "unknown_provider",
  "invalid_credentials",
  "unsupported_currency",
  "invalid",
]);

/** A missing service, with the words the MCP tool `get_investment_holdings` has always said. */
export function notFound(): ApiRefusal {
  const refusal = new ApiRefusal("not_found");
  refusal.message = "Investment service not found.";
  return refusal;
}

/** Runs a use case of the module and turns its refusal into the contract's. */
export async function refusing<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof InvestmentError || error instanceof SyncError || error instanceof AccountError) {
      if (error.code === "not_found") throw notFound();
      if (INVALID.has(error.code))
        throw new ApiRefusal("invalid", error.code === "invalid" ? undefined : error.code);
      throw new ApiRefusal("conflict", error.code);
    }
    if (error instanceof RangeError) throw new ApiRefusal("invalid");
    if (error instanceof Error && error.name === "ZodError") throw new ApiRefusal("invalid");
    throw error;
  }
}

export const decimal = (value: string | null, scale: number) =>
  value === null ? null : parseDecimal(value, scale);
export const cents = (value: string | null) => (value === null ? null : parseCents(value));
