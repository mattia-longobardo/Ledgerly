import "server-only";
import { and, eq, inArray, isNotNull, lt, lte, ne, sql } from "drizzle-orm";
import { getAccount } from "@/modules/accounts/queries";
import { transactionsByIds } from "@/modules/transactions/queries";
import type { Ctx } from "@/platform/context";
import { isFutureDate } from "@/modules/accounts/rules";
import { addDays, type CivilDate, type MonthKey, monthKey, today } from "@/platform/dates";
import { getDb } from "@/platform/db/client";
import { hasPgError, UNIQUE_VIOLATION } from "@/platform/db/errors";
import { userScoped } from "@/platform/db/scope";
import type { Cents } from "@/platform/money";
import { moveSchema, PLANNED_GRACE_DAYS, type PocketInput, pocketInputSchema, plannedSchema } from "./rules";
import { pocketExpenseLinks, pocketMovements, pocketPlannedExpenses, pockets } from "./schema";

export type Pocket = typeof pockets.$inferSelect;
export type PocketMovement = typeof pocketMovements.$inferSelect;

export type PocketErrorCode =
  | "not_found"
  | "invalid_account"
  | "duplicate_name"
  | "archived"
  | "future_date"
  | "past_date"
  | "backed"
  | "not_expense"
  | "already_linked";

export class PocketError extends Error {
  constructor(readonly code: PocketErrorCode) {
    super(code);
    this.name = "PocketError";
  }
}

async function requirePocket(ctx: Pick<Ctx, "userId">, id: string): Promise<Pocket> {
  const [row] = await getDb()
    .select()
    .from(pockets)
    .where(and(eq(pockets.id, id), userScoped(ctx).owns(pockets)));
  if (!row) throw new PocketError("not_found");
  return row;
}

/** A pocket rests only on one of this user's own accounts, and not on an archived one. */
async function requireBackingAccount(ctx: Pick<Ctx, "userId">, id: string | null): Promise<void> {
  if (id === null) return;
  const account = await getAccount(ctx, id);
  if (!account || account.state === "archived") throw new PocketError("invalid_account");
}

function duplicateName<T>(write: Promise<T>): Promise<T> {
  return write.catch((error: unknown) => {
    if (hasPgError(error, UNIQUE_VIOLATION, "pockets_user_name_uq")) throw new PocketError("duplicate_name");
    throw error;
  });
}

/**
 * The month's `accrual` for every active pocket with a monthly amount whose start month has come
 * (spec §7.4), or only for `pocketIds`. Idempotent by construction: the database holds one accrual
 * per pocket and month (`pocket_movements_accrual_uq`), and a second call finds the slot taken.
 * No arrears: a start month in the past does not write the months before `month`, and a paused
 * pocket gets nothing for the months it was paused (plan F3 §3.4.9).
 */
export async function accrueMonth(
  ctx: Pick<Ctx, "userId">,
  month: MonthKey,
  pocketIds?: readonly string[],
): Promise<{ written: number }> {
  const due = await getDb()
    .select({ id: pockets.id, monthlyCents: pockets.monthlyCents })
    .from(pockets)
    .where(
      and(
        userScoped(ctx).owns(pockets),
        eq(pockets.state, "active"),
        isNotNull(pockets.monthlyCents),
        lte(pockets.startMonth, month),
        pocketIds === undefined ? undefined : inArray(pockets.id, [...pocketIds]),
      ),
    );
  if (due.length === 0) return { written: 0 };
  const written = await getDb()
    .insert(pocketMovements)
    .values(
      due.map((pocket) =>
        userScoped(ctx).stamp({
          pocketId: pocket.id,
          kind: "accrual" as const,
          amountCents: pocket.monthlyCents as Cents,
          on: month,
        }),
      ),
    )
    .onConflictDoNothing({
      target: [pocketMovements.pocketId, pocketMovements.on],
      where: sql`${pocketMovements.kind} = 'accrual'`,
    })
    .returning({ id: pocketMovements.id });
  return { written: written.length };
}

/**
 * A new pocket. One whose start month has already come accrues the current month at once, rather
 * than sitting empty until the 1st (plan F3 §3.4.9).
 */
export async function createPocket(
  ctx: Pick<Ctx, "userId" | "timeZone">,
  input: PocketInput,
): Promise<Pocket> {
  const parsed = pocketInputSchema.parse(input);
  await requireBackingAccount(ctx, parsed.backingAccountId);
  const [row] = await duplicateName(
    getDb().insert(pockets).values(userScoped(ctx).stamp(parsed)).returning(),
  );
  await accrueMonth(ctx, monthKey(today(ctx.timeZone)), [row.id]);
  return row;
}

export async function updatePocket(
  ctx: Pick<Ctx, "userId" | "timeZone">,
  id: string,
  input: PocketInput,
): Promise<Pocket> {
  const current = await requirePocket(ctx, id);
  const parsed = pocketInputSchema.parse(input);
  if (parsed.backingAccountId !== current.backingAccountId) {
    await requireBackingAccount(ctx, parsed.backingAccountId);
  }
  const [row] = await duplicateName(
    getDb()
      .update(pockets)
      .set(parsed)
      .where(and(eq(pockets.id, id), userScoped(ctx).owns(pockets)))
      .returning(),
  );
  // A monthly amount set, or a start month moved to now, on an active pocket: this month too.
  await accrueMonth(ctx, monthKey(today(ctx.timeZone)), [row.id]);
  return row;
}

/**
 * Pause, resume, archive or restore. Resuming (or restoring) an active pocket accrues the current
 * month if it has none yet; the months in between stay without one.
 */
export async function setPocketState(
  ctx: Pick<Ctx, "userId" | "timeZone">,
  id: string,
  state: "active" | "paused" | "archived",
): Promise<void> {
  await requirePocket(ctx, id);
  await getDb()
    .update(pockets)
    .set({ state, archivedAt: state === "archived" ? new Date() : null })
    .where(and(eq(pockets.id, id), userScoped(ctx).owns(pockets)));
  if (state === "active") await accrueMonth(ctx, monthKey(today(ctx.timeZone)), [id]);
}

/** "Add to pocket" (spec §7.4): a positive `deposit`. No money moves. */
export async function addToPocket(
  ctx: Pick<Ctx, "userId" | "timeZone">,
  id: string,
  input: { cents: Cents; on: string; reason?: string | null },
): Promise<void> {
  const parsed = moveSchema.parse(input);
  const pocket = await requirePocket(ctx, id);
  if (pocket.state === "archived") throw new PocketError("archived");
  if (isFutureDate(parsed.on, today(ctx.timeZone))) throw new PocketError("future_date");
  await getDb()
    .insert(pocketMovements)
    .values(
      userScoped(ctx).stamp({
        pocketId: id,
        kind: "deposit" as const,
        amountCents: parsed.cents,
        on: parsed.on,
        reason: parsed.reason,
      }),
    );
}

/**
 * Files an expense under a standalone pocket. A pocket on an account takes its account's expenses
 * on its own, so it refuses links (`backed`); an expense of an account some open pocket rests on is
 * counted there already (`backed` too). Only a visible `expense` qualifies — never a giroconto or an
 * income — and one pocket per expense (`already_linked`).
 */
export async function linkExpense(
  ctx: Pick<Ctx, "userId">,
  pocketId: string,
  transactionId: string,
): Promise<void> {
  const pocket = await requirePocket(ctx, pocketId);
  if (pocket.state === "archived") throw new PocketError("archived");
  if (pocket.backingAccountId !== null) throw new PocketError("backed");
  const movement = (await transactionsByIds(ctx, [transactionId])).get(transactionId);
  if (
    !movement ||
    movement.type !== "expense" ||
    movement.amountCents >= 0n ||
    movement.hiddenAt !== null ||
    movement.removedUpstreamAt !== null
  ) {
    throw new PocketError("not_expense");
  }
  const [backing] = await getDb()
    .select({ id: pockets.id })
    .from(pockets)
    .where(
      and(
        userScoped(ctx).owns(pockets),
        eq(pockets.backingAccountId, movement.accountId),
        ne(pockets.state, "archived"),
      ),
    )
    .limit(1);
  if (backing) throw new PocketError("backed");
  await getDb()
    .insert(pocketExpenseLinks)
    .values(userScoped(ctx).stamp({ pocketId, transactionId }))
    .catch((error: unknown) => {
      if (hasPgError(error, UNIQUE_VIOLATION, "pocket_expense_links_transaction_uq")) {
        throw new PocketError("already_linked");
      }
      throw error;
    });
}

/** Takes an expense back out of a standalone pocket. */
export async function unlinkExpense(
  ctx: Pick<Ctx, "userId">,
  pocketId: string,
  transactionId: string,
): Promise<void> {
  const removed = await getDb()
    .delete(pocketExpenseLinks)
    .where(
      and(
        userScoped(ctx).owns(pocketExpenseLinks),
        eq(pocketExpenseLinks.pocketId, pocketId),
        eq(pocketExpenseLinks.transactionId, transactionId),
      ),
    )
    .returning({ id: pocketExpenseLinks.id });
  if (removed.length === 0) throw new PocketError("not_found");
}

/** An expense expected on a day to come: today or later, never in the past. */
export async function addPlannedExpense(
  ctx: Pick<Ctx, "userId" | "timeZone">,
  pocketId: string,
  input: { cents: Cents; dueOn: string; description: string },
): Promise<void> {
  const parsed = plannedSchema.parse(input);
  const pocket = await requirePocket(ctx, pocketId);
  if (pocket.state === "archived") throw new PocketError("archived");
  if (parsed.dueOn < today(ctx.timeZone)) throw new PocketError("past_date");
  await getDb()
    .insert(pocketPlannedExpenses)
    .values(
      userScoped(ctx).stamp({
        pocketId,
        description: parsed.description,
        amountCents: parsed.cents,
        dueOn: parsed.dueOn,
      }),
    );
}

export async function removePlannedExpense(ctx: Pick<Ctx, "userId">, id: string): Promise<void> {
  const removed = await getDb()
    .delete(pocketPlannedExpenses)
    .where(and(eq(pocketPlannedExpenses.id, id), userScoped(ctx).owns(pocketPlannedExpenses)))
    .returning({ id: pocketPlannedExpenses.id });
  if (removed.length === 0) throw new PocketError("not_found");
}

/** The planned expenses more than a week past their day: what the daily job drops. */
export async function purgeExpiredPlanned(ctx: Pick<Ctx, "userId">, todayOn: CivilDate): Promise<number> {
  const removed = await getDb()
    .delete(pocketPlannedExpenses)
    .where(
      and(
        userScoped(ctx).owns(pocketPlannedExpenses),
        lt(pocketPlannedExpenses.dueOn, addDays(todayOn, -PLANNED_GRACE_DAYS)),
      ),
    )
    .returning({ id: pocketPlannedExpenses.id });
  return removed.length;
}
