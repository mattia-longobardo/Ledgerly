// The rows of the module, its refusals and the helpers every write shares.
import type { Ctx } from "../../../platform/context";
import { type CivilDate, isCivilDate, today } from "../../../shared/dates";
import { hasPgError, UNIQUE_VIOLATION } from "../../../platform/db/errors";
import { formatDecimal, parseDecimal } from "../../../shared/money";
import {
  investmentAccountPeriods,
  investmentAccounts,
  investmentAssets,
  investmentEvents,
  investmentHoldings,
  investmentOperations,
  investmentReadings,
} from "../schema";

export type InvestmentAccount = typeof investmentAccounts.$inferSelect;
export type InvestmentAsset = typeof investmentAssets.$inferSelect;
export type InvestmentHolding = typeof investmentHoldings.$inferSelect;
export type InvestmentEvent = typeof investmentEvents.$inferSelect;
export type InvestmentOperation = typeof investmentOperations.$inferSelect;
export type InvestmentPeriod = typeof investmentAccountPeriods.$inferSelect;
export type InvestmentReading = typeof investmentReadings.$inferSelect;

export type InvestmentErrorCode =
  | "not_found"
  | "future_date"
  | "not_eligible"
  | "wrong_mode"
  | "negative_cash"
  | "no_value"
  | "duplicate_asset"
  | "duplicate_holding"
  | "invalid_transaction"
  | "already_linked"
  | "not_editable"
  | "before_period"
  // A write before a manual portfolio's first day, when the days before were a value only (R5d, P4).
  | "before_positions"
  | "not_a_transfer"
  // A sale of more than the quantity held that day (R5d).
  | "quantity_exceeded"
  // A write of the R5d model on a basket plan (PERS-681): «Record the past instalments».
  | "plan_model_retired";

export class InvestmentError extends Error {
  constructor(readonly code: InvestmentErrorCode) {
    super(code);
    this.name = "InvestmentError";
  }
}

export type WriteCtx = Pick<Ctx, "userId" | "timeZone">;

export function translated<T>(write: Promise<T>): Promise<T> {
  return write.catch((error: unknown) => {
    if (hasPgError(error, UNIQUE_VIOLATION, "investment_events_transaction_uq")) {
      throw new InvestmentError("already_linked");
    }
    if (
      hasPgError(error, UNIQUE_VIOLATION, "investment_assets_isin_uq") ||
      hasPgError(error, UNIQUE_VIOLATION, "investment_assets_symbol_uq")
    ) {
      throw new InvestmentError("duplicate_asset");
    }
    if (hasPgError(error, UNIQUE_VIOLATION, "investment_holdings_uq")) {
      throw new InvestmentError("duplicate_holding");
    }
    throw error;
  });
}

export function notFuture(ctx: WriteCtx, on: CivilDate): void {
  if (!isCivilDate(on)) throw new RangeError(`Not a civil date: "${on}"`);
  if (on > today(ctx.timeZone)) throw new InvestmentError("future_date");
}

export const decimal = (value: bigint | null, scale: number) =>
  value === null ? null : formatDecimal(value, scale);
export const fromNumeric = (value: string | null, scale: number) =>
  value === null ? null : parseDecimal(value, scale);
