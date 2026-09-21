import "server-only";
import { Hono } from "hono";
import { z } from "zod";
import type { ApiEnv } from "@/platform/api/auth";
import { withToken } from "@/platform/api/auth";
import { fail } from "@/platform/api/errors";
import { instant, money } from "@/platform/api/json";
import { isCivilDate } from "@/platform/dates";
import { listTransactions, MAX_LIMIT, transactionsSummary } from "./queries";
import { TRANSACTION_TYPES } from "./rules";

/**
 * The transactions module's `/api/v1` routes (spec §4.2). One list, filtered the way the Expenses
 * page filters it, plus the same totals its header shows — never recomputed here (D5).
 */
export const transactionsApi = new Hono<ApiEnv>();

const civilDate = z.string().refine(isCivilDate, "Not a civil date");

const query = z.object({
  from: civilDate.optional(),
  to: civilDate.optional(),
  account: z.uuid().optional(),
  type: z.enum(TRANSACTION_TYPES).optional(),
  payee: z.string().trim().min(1).max(200).optional(),
  limit: z.coerce.number().int().min(1).max(MAX_LIMIT).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

transactionsApi.get("/transactions", withToken("read"), async (c) => {
  const ctx = c.get("ctx");
  const parsed = query.safeParse(
    Object.fromEntries(Object.entries(c.req.query()).filter(([, value]) => value !== "")),
  );
  if (!parsed.success) return fail(c, "invalid");
  const { account, type, ...rest } = parsed.data;
  const filters = {
    ...rest,
    accountIds: account ? [account] : undefined,
    types: type ? [type] : undefined,
  };
  const [rows, summary] = await Promise.all([
    listTransactions(ctx, filters),
    transactionsSummary(ctx, filters),
  ]);
  return c.json({
    transactions: rows.map((row) => ({
      id: row.id,
      on: row.on,
      occurredAt: instant(row.occurredAt),
      accountId: row.accountId,
      accountName: row.accountName,
      amount: money(row.amountCents),
      currency: row.currency,
      type: row.type,
      state: row.state,
      categoryId: row.categoryId,
      categoryName: row.categoryName,
      payee: row.payee,
      note: row.note,
      labels: row.labels.map((label) => label.name),
      hidden: row.hidden,
    })),
    summary: {
      count: summary.count,
      income: money(summary.incomeCents),
      expense: money(summary.expenseCents),
      net: money(summary.netCents),
    },
  });
});
