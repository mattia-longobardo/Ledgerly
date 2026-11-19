// Accounts · the refusal of the module as the contract names it.
import { AccountError } from "@ledgerly/domain/accounts";
import { ApiRefusal } from "../serve";

const INVALID = new Set(["future_date", "iban_invalid", "invalid"]);

/** An `AccountError` as the contract answers it: the code in `reason`, never the IBAN (H45). */
export function accountRefusal(error: unknown): unknown {
  if (!(error instanceof AccountError)) return error;
  if (error.code === "not_found") return new ApiRefusal("not_found");
  return new ApiRefusal(
    INVALID.has(error.code) ? "invalid" : "conflict",
    error.code,
    error.other ?? undefined,
  );
}

/** Runs a use case of the module and turns its refusal into the contract's. */
export async function refusing<T>(work: Promise<T>): Promise<T> {
  try {
    return await work;
  } catch (error) {
    throw accountRefusal(error);
  }
}
