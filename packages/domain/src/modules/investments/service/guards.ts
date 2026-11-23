// What a manual portfolio may never hold (rewrite plan R5d): checked after every write, inside its
// transaction, so a write that breaks it leaves nothing behind.
import type { Tx } from "../../../platform/db/client";
import { PORTFOLIO_PROVIDER } from "../catalog";
import { negativeCash, shortPosition } from "../rules";
import { loadBook } from "./book";
import { type InvestmentAccount, InvestmentError, type WriteCtx } from "./types";

/**
 * A manual portfolio never holds less than nothing, at the end of any day: a position below zero — a
 * sale of more than is held, or a purchase changed or deleted under a later sale — refuses the write
 * with `quantity_exceeded`; cash below zero — a purchase, a fee or a withdrawal with no money for it,
 * or a deposit changed or deleted under a later one — with `negative_cash` (D2, Mattia 23/11/2026).
 * The order of a day's operations does not count.
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
  if (negativeCash(book) !== null) throw new InvestmentError("negative_cash");
}
