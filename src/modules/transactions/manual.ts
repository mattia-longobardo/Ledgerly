// modules/transactions/manual.ts — the movement a person writes by hand (rewrite plan, 04-now.md
// §4.5): create, change, delete. Every decision about the fields is in `manual-rules.ts`.
//
// What a manual movement does to its account's balance is the accounts module's rule: the caller
// that joins the two (`app/(app)/expenses/manual.ts`) runs it after each of these, and decides
// before them whether the account takes a manual movement at all. Nothing here reaches the network.
import "server-only";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import type { Ctx } from "@/platform/context";
import { today } from "@/platform/dates";
import { getDb } from "@/platform/db/client";
import { userScoped } from "@/platform/db/scope";
import { isAfterToday, manualColumns, manualMovementSchema } from "./manual-rules";
import { type Transaction, getTransaction } from "./queries";
import { transactions } from "./schema";
import {
  chosenBy,
  requireMovementAccount,
  requireOwnCategory,
  requireTransaction,
  TransactionError,
} from "./service";

type ManualCtx = Pick<Ctx, "userId" | "timeZone">;

async function parsed(ctx: ManualCtx, input: unknown) {
  const movement = manualMovementSchema.parse(input);
  if (isAfterToday(movement.on, today(ctx.timeZone))) throw new TransactionError("future_date");
  const account = await requireMovementAccount(ctx, movement.accountId);
  await requireOwnCategory(ctx, movement.categoryId);
  const columns = manualColumns(movement, account.currency, ctx.timeZone);
  // A category the person left in the dialog is their choice, a suggestion they saw included.
  return { ...columns, ...chosenBy(columns.categoryId === null ? null : "user") };
}

async function byKey(ctx: ManualCtx, idempotencyKey: string): Promise<Transaction | null> {
  const [row] = await getDb()
    .select({ id: transactions.id })
    .from(transactions)
    .where(and(userScoped(ctx).owns(transactions), eq(transactions.idempotencyKey, idempotencyKey)));
  return row ? getTransaction(ctx, row.id) : null;
}

/**
 * Writes a manual movement. With an `idempotencyKey` the same request sent twice — a double
 * click, a retry after a lost answer — is one row: the second call answers with the row the first
 * one wrote and `created: false`, whatever its fields say.
 */
export async function createManualTransaction(
  ctx: ManualCtx,
  input: unknown,
  idempotencyKey?: string,
): Promise<{ transaction: Transaction; created: boolean }> {
  if (idempotencyKey !== undefined) {
    const sent = await byKey(ctx, idempotencyKey);
    if (sent) return { transaction: sent, created: false };
  }
  const columns = await parsed(ctx, input);
  const [row] = await getDb()
    .insert(transactions)
    .values(
      userScoped(ctx).stamp({
        ...columns,
        origin: "manual" as const,
        idempotencyKey: idempotencyKey ?? null,
      }),
    )
    // Two requests with one key that passed the read above together: the second writes nothing.
    .onConflictDoNothing()
    .returning({ id: transactions.id });
  if (row) return { transaction: await requireTransaction(ctx, row.id), created: true };
  const sent = idempotencyKey === undefined ? null : await byKey(ctx, idempotencyKey);
  if (!sent) throw new TransactionError("invalid");
  return { transaction: sent, created: false };
}

async function requireManual(ctx: ManualCtx, id: string): Promise<Transaction> {
  if (!z.uuid().safeParse(id).success) throw new TransactionError("invalid");
  const current = await requireTransaction(ctx, id);
  if (current.origin !== "manual") throw new TransactionError("not_manual");
  return current;
}

/**
 * Changes a manual movement: every field is the person's, so nothing is marked as edited here.
 * `previousAccountId` is the account it was on, whose balance changes too when the account does.
 */
export async function updateManualTransaction(
  ctx: ManualCtx,
  id: string,
  input: unknown,
): Promise<{ transaction: Transaction; previousAccountId: string }> {
  const current = await requireManual(ctx, id);
  const columns = await parsed(ctx, input);
  await getDb()
    .update(transactions)
    .set(columns)
    .where(
      and(
        eq(transactions.id, current.id),
        eq(transactions.origin, "manual"),
        userScoped(ctx).owns(transactions),
      ),
    );
  return { transaction: await requireTransaction(ctx, current.id), previousAccountId: current.accountId };
}

/** Deletes a manual movement for good: it is the person's own, with no provider to bring it back. */
export async function deleteManualTransaction(ctx: ManualCtx, id: string): Promise<{ accountId: string }> {
  const current = await requireManual(ctx, id);
  await getDb()
    .delete(transactions)
    .where(
      and(
        eq(transactions.id, current.id),
        eq(transactions.origin, "manual"),
        userScoped(ctx).owns(transactions),
      ),
    );
  return { accountId: current.accountId };
}
