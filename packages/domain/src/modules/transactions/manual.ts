// modules/transactions/manual.ts — the movement a person writes by hand (rewrite plan, 04-now.md
// §4.5): create, change, delete. Every decision about the fields is in `manual-rules.ts`.
//
// What a manual movement does to its account's balance is the accounts module's rule: the caller
// that joins the two (`app/(app)/expenses/manual.ts`) runs it after each of these, and decides
// before them whether the account takes a manual movement at all. Nothing here reaches the network.
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import type { Ctx } from "../../platform/context";
import { today } from "../../shared/dates";
import { getDb } from "../../platform/db/client";
import { userScoped } from "../../platform/db/scope";
import { retypeMovements } from "./macro";
import { linkOwnTransfers, requireOtherAccount } from "./service/giroconti";
import { withMarkers } from "./service/pairing-marks";
import { rebuildTwinBalances, refreshTwins, twinAccountsOf, writeTwin } from "./service/twins";
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

type AccountCheck = ReturnType<typeof requireMovementAccount>;

/** The checks of the account and of the category, each asked once per id over many movements. */
function checksOnce(ctx: ManualCtx) {
  const accounts = new Map<string, AccountCheck>();
  const categories = new Map<string, Promise<void>>();
  return {
    account(id: string): AccountCheck {
      const check = accounts.get(id) ?? requireMovementAccount(ctx, id);
      accounts.set(id, check);
      return check;
    },
    category(id: string | null): Promise<void> {
      if (id === null) return Promise.resolve();
      const check = categories.get(id) ?? requireOwnCategory(ctx, id);
      categories.set(id, check);
      return check;
    },
  };
}

/**
 * A giroconto written by hand finds its other leg as one a source wrote does, and on a manual
 * account, where none ever arrives, gets it written (PERS-733).
 */
async function pairWritten(ctx: ManualCtx, id: string): Promise<void> {
  await linkOwnTransfers(ctx, [id]);
  await writeTwin(ctx, id);
}

async function parsed(ctx: ManualCtx, input: unknown, checks = checksOnce(ctx)) {
  const movement = manualMovementSchema.parse(input);
  if (isAfterToday(movement.on, today(ctx.timeZone))) throw new TransactionError("future_date");
  const account = await checks.account(movement.accountId);
  await checks.category(movement.categoryId);
  await requireOtherAccount(ctx, movement.accountId, movement.transferAccountId);
  const columns = manualColumns(movement, account.currency, ctx.timeZone);
  // A category the person left in the dialog is their choice, a suggestion they saw included.
  return { ...columns, ...chosenBy(columns.categoryId === null ? null : "user") };
}

/** The row of a manual movement, from its columns. */
function manualRow(
  ctx: ManualCtx,
  columns: Awaited<ReturnType<typeof parsed>>,
  idempotencyKey: string | null,
  toSend: boolean,
) {
  return userScoped(ctx).stamp({
    ...columns,
    // A giroconto is the person's choice: the `type` marker keeps it one while it waits.
    locallyEdited: columns.type === "transfer" ? ["type"] : [],
    origin: "manual" as const,
    idempotencyKey,
    sendState: toSend ? ("to_send" as const) : null,
  });
}

async function byKey(ctx: ManualCtx, idempotencyKey: string): Promise<Transaction | null> {
  const [row] = await getDb()
    .select({ id: transactions.id })
    .from(transactions)
    .where(and(userScoped(ctx).owns(transactions), eq(transactions.idempotencyKey, idempotencyKey)));
  return row ? getTransaction(ctx, row.id) : null;
}

/** What the caller knows about the account and this module does not. */
interface ManualOptions {
  /** The account's source takes the movements written here: this one waits for the next update. */
  toSend?: boolean;
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
  options: ManualOptions = {},
): Promise<{ transaction: Transaction; created: boolean }> {
  if (idempotencyKey !== undefined) {
    const sent = await byKey(ctx, idempotencyKey);
    if (sent) return { transaction: sent, created: false };
  }
  const columns = await parsed(ctx, input);
  const [row] = await getDb()
    .insert(transactions)
    .values(manualRow(ctx, columns, idempotencyKey ?? null, options.toSend === true))
    // Two requests with one key that passed the read above together: the second writes nothing.
    .onConflictDoNothing()
    .returning({ id: transactions.id });
  if (row) {
    await retypeMovements(getDb(), ctx);
    if (columns.transferAccountId !== null) await pairWritten(ctx, row.id);
    return { transaction: await requireTransaction(ctx, row.id), created: true };
  }
  const sent = idempotencyKey === undefined ? null : await byKey(ctx, idempotencyKey);
  if (!sent) throw new TransactionError("invalid");
  return { transaction: sent, created: false };
}

/** How many rows one insert of a batch writes. */
const BATCH_CHUNK = 1000;

/** The rows in the pieces one insert takes. */
function* piecesOf<T>(rows: readonly T[]): Generator<T[]> {
  for (let start = 0; start < rows.length; start += BATCH_CHUNK) yield rows.slice(start, start + BATCH_CHUNK);
}

/**
 * Writes many manual movements at once, each with its own key (an import: decision ST-8), on the
 * path of `createManualTransaction`: the same checks and the same row, in one transaction. A key
 * already written is a movement already there: it writes nothing and is not counted. The caller
 * rebuilds the balance, as for one movement.
 */
export async function createManualTransactions(
  ctx: ManualCtx,
  movements: readonly { input: unknown; key: string }[],
): Promise<{ created: number }> {
  const checks = checksOnce(ctx);
  const rows: ReturnType<typeof manualRow>[] = [];
  for (const movement of movements) {
    rows.push(manualRow(ctx, await parsed(ctx, movement.input, checks), movement.key, false));
  }
  if (rows.length === 0) return { created: 0 };
  return getDb().transaction(async (transaction) => {
    let created = 0;
    for (const piece of piecesOf(rows)) {
      const insert = transaction.insert(transactions).values(piece).onConflictDoNothing();
      created += (await insert.returning({ id: transactions.id })).length;
    }
    if (created > 0) await retypeMovements(transaction, ctx);
    return { created };
  });
}

async function requireManual(ctx: ManualCtx, id: string): Promise<Transaction> {
  if (!z.uuid().safeParse(id).success) throw new TransactionError("invalid");
  const current = await requireTransaction(ctx, id);
  if (current.origin !== "manual") throw new TransactionError("not_manual");
  return current;
}

/**
 * Changes a manual movement: every field is the person's, so nothing is marked as edited here.
 * A movement that waits for its source goes with the fields it has when the update comes.
 * `previousAccountId` is the account it was on, whose balance changes too when the account does.
 */
export async function updateManualTransaction(
  ctx: ManualCtx,
  id: string,
  input: unknown,
  options: ManualOptions = {},
): Promise<{ transaction: Transaction; previousAccountId: string }> {
  const current = await requireManual(ctx, id);
  const columns = await parsed(ctx, input);
  // A movement the source may already hold ("not sent") stays so: the next update looks for it
  // there before it asks again. On an account with no source to send to, it waits for nothing.
  const sendState = options.toSend ? (current.sendState ?? ("to_send" as const)) : null;
  await getDb()
    .update(transactions)
    // The form gives a kind and a category: a giroconto it was stops being one, its partner waits.
    .set({
      ...columns,
      ...(columns.type === "transfer" ? { locallyEdited: withMarkers(current.locallyEdited, "type") } : {}),
      sendState,
      ...(sendState === null ? { sendAskedOn: null } : {}),
      transferGroupId: null,
      transferOutside: false,
      // Changed by hand: a leg the server wrote is the person's from now on (PERS-733).
      twinOf: null,
    })
    .where(
      and(
        eq(transactions.id, current.id),
        eq(transactions.origin, "manual"),
        userScoped(ctx).owns(transactions),
      ),
    );
  await retypeMovements(getDb(), ctx);
  // Its written leg follows the change, or goes with the giroconto.
  await refreshTwins(ctx, [current.id]);
  if (current.transferGroupId !== null) await linkOwnTransfers(ctx);
  if (columns.transferAccountId !== null) await pairWritten(ctx, current.id);
  return { transaction: await requireTransaction(ctx, current.id), previousAccountId: current.accountId };
}

/** Deletes a manual movement for good: it is the person's own, with no provider to bring it back. */
export async function deleteManualTransaction(ctx: ManualCtx, id: string): Promise<{ accountId: string }> {
  const current = await requireManual(ctx, id);
  // Its written leg goes with it (`twin_of` cascades): that account's balance changes too.
  const twinAccounts = await twinAccountsOf(ctx, [current.id]);
  await getDb()
    .delete(transactions)
    .where(
      and(
        eq(transactions.id, current.id),
        eq(transactions.origin, "manual"),
        userScoped(ctx).owns(transactions),
      ),
    );
  await rebuildTwinBalances(ctx, twinAccounts);
  return { accountId: current.accountId };
}
