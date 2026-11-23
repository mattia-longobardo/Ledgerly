// What a manual portfolio may never hold (rewrite plan R5d): checked after every write, inside its
// transaction, so a write that breaks it leaves nothing behind.
import type { Tx } from "../../../platform/db/client";
import { PORTFOLIO_PROVIDER } from "../catalog";
import { negativeCash, shortPosition } from "../rules";
import { loadBook } from "./book";
import { type InvestmentAccount, InvestmentError, type WriteCtx } from "./types";

/**
 * What a manual portfolio does with cash below zero at the end of a day: the one switch of the rule.
 * shortcut: `allow` until Mattia chooses between `refuse` (409 `negative_cash`) and a warning (D2);
 * the day is already found by `negativeCash`.
 */
const CASH_RULE: { belowZero: "allow" | "refuse" } = { belowZero: "allow" };

/**
 * A manual portfolio never holds less than nothing: a position below zero at the end of a day — a sale
 * of more than is held, or a purchase changed or deleted under a later sale — refuses the write.
 */
export async function checkPortfolio(
  ctx: WriteCtx,
  investment: InvestmentAccount,
  currency: string,
  transaction: Tx,
): Promise<void> {
  if (investment.provider !== PORTFOLIO_PROVIDER) return;
  const book = await loadBook(ctx, investment, currency, transaction);
  if (shortPosition(book) !== null) throw new InvestmentError("quantity_exceeded");
  if (CASH_RULE.belowZero === "refuse" && negativeCash(book) !== null)
    throw new InvestmentError("negative_cash");
}
