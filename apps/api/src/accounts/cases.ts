// Accounts · the use cases the Server Actions and the routes share (rewrite plan R2 criterion 4),
// and the refusal of the module as the contract names it.
import { AccountError, updateAccountSettings } from "@ledgerly/domain/accounts";
import type { Ctx } from "@ledgerly/domain/platform/context";
import { linkOwnTransfers } from "@ledgerly/domain/transactions";
import { ApiRefusal } from "../serve";

/**
 * Changes an account's settings, then joins the giroconti a new IBAN makes of movements already
 * stored (F2.5), as the settings form does. shortcut: two calls in the form and here until the
 * step's `MovementsPort` lets `updateAccountSettings` join them itself (ACC-8).
 */
export async function changeAccountSettings(ctx: Ctx, id: string, input: unknown): Promise<void> {
  await updateAccountSettings(ctx, id, input);
  await linkOwnTransfers(ctx);
}

const INVALID = new Set(["future_date", "iban_invalid", "invalid"]);

/** An `AccountError` as the contract answers it: the code in `reason`, never the IBAN (H45). */
export function accountRefusal(error: unknown): unknown {
  if (!(error instanceof AccountError)) return error;
  if (error.code === "not_found") return new ApiRefusal("not_found");
  return new ApiRefusal(INVALID.has(error.code) ? "invalid" : "conflict", error.code);
}

/** Runs a use case of the module and turns its refusal into the contract's. */
export async function refusing<T>(work: Promise<T>): Promise<T> {
  try {
    return await work;
  } catch (error) {
    throw accountRefusal(error);
  }
}
