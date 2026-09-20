import "server-only";
import { and, eq, inArray, isNotNull, lte, sql } from "drizzle-orm";
import { getAccount } from "@/modules/accounts/queries";
import type { Ctx } from "@/platform/context";
import { isFutureDate } from "@/modules/accounts/rules";
import { type MonthKey, monthKey, today } from "@/platform/dates";
import { getDb } from "@/platform/db/client";
import { hasPgError, UNIQUE_VIOLATION } from "@/platform/db/errors";
import { userScoped } from "@/platform/db/scope";
import type { Cents } from "@/platform/money";
import { moveSchema, pocketBalance, type PocketInput, pocketInputSchema, withdrawalSchema } from "./rules";
import { pocketMovements, pockets } from "./schema";

export type Pocket = typeof pockets.$inferSelect;
export type PocketMovement = typeof pocketMovements.$inferSelect;

export type PocketErrorCode =
  "not_found" | "invalid_account" | "duplicate_name" | "archived" | "future_date" | "insufficient";

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
 * "Record withdrawal" (spec §7.4): money actually spent from the pocket, as a negative movement
 * with its reason. Never below zero: the pocket row is locked while the balance is read, so two
 * withdrawals at once cannot both pass the check.
 */
export async function recordWithdrawal(
  ctx: Pick<Ctx, "userId" | "timeZone">,
  id: string,
  input: { cents: Cents; on: string; reason: string },
): Promise<void> {
  const parsed = withdrawalSchema.parse(input);
  if (isFutureDate(parsed.on, today(ctx.timeZone))) throw new PocketError("future_date");
  await getDb().transaction(async (tx) => {
    const [pocket] = await tx
      .select({ state: pockets.state })
      .from(pockets)
      .where(and(eq(pockets.id, id), userScoped(ctx).owns(pockets)))
      .for("update");
    if (!pocket) throw new PocketError("not_found");
    if (pocket.state === "archived") throw new PocketError("archived");
    const movements = await tx
      .select({ amountCents: pocketMovements.amountCents })
      .from(pocketMovements)
      .where(and(eq(pocketMovements.pocketId, id), userScoped(ctx).owns(pocketMovements)));
    if (pocketBalance(movements) < parsed.cents) throw new PocketError("insufficient");
    await tx.insert(pocketMovements).values(
      userScoped(ctx).stamp({
        pocketId: id,
        kind: "withdrawal" as const,
        amountCents: -parsed.cents,
        on: parsed.on,
        reason: parsed.reason,
      }),
    );
  });
}
