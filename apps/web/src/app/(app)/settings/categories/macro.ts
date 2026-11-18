// src/app/(app)/settings/categories/macro.ts — "Move to another section" as one use case
// (categories-and-rules.md §5.6, N3.3). The category and its movements are the transactions
// module's, the budgets the budgets module's; subscriptions, pockets and interests only say how
// many of the movements they use (§3.5). Only the application joins them, in one transaction.
import "server-only";
import { z } from "zod";
import { listAccounts } from "@ledgerly/domain/accounts";
import { limitsSnapshot, type LimitsSnapshot, restoreLimits, stopLimitsOf } from "@ledgerly/domain/budgets";
import { postsUnderAny } from "@ledgerly/domain/interests";
import { expensesAmong } from "@ledgerly/domain/pockets";
import { chargesAmong } from "@ledgerly/domain/subscriptions";
import { TransactionError } from "@ledgerly/domain/transactions";
import {
  getCategory,
  type MacroPlace,
  macroMoveFacts,
  moveCategoryToMacro,
  movesBetweenMacros,
} from "@ledgerly/domain/transactions";
import type { CategoryType } from "@ledgerly/domain/transactions";
import type { Ctx } from "@ledgerly/domain/platform/context";
import { monthKey, today } from "@ledgerly/domain/shared/dates";
import { getDb } from "@ledgerly/domain/platform/db";
import { sourceNotes } from "./source";

type Who = Pick<Ctx, "userId" | "timeZone" | "locale">;

/** What the dialog says before the move: the numbers that change (§3.3, §3.5, QC8). */
export interface MacroMoveView {
  from: CategoryType;
  /** Movements that count in `from` now and will not, their total (absolute), the first year. */
  count: number;
  amountCents: bigint;
  firstYear: number | null;
  linked: { subscriptions: number; pockets: number; interests: number };
  /** Whether a budget of the category stops from this month (a move to Transfers). */
  stopsBudget: boolean;
  /** The names of the sources whose categories count under it: their movements move too. */
  sources: string[];
}

export async function macroMoveView(ctx: Who, id: string): Promise<MacroMoveView> {
  const category = await getCategory(ctx, id);
  if (!movesBetweenMacros(category)) throw new TransactionError("invalid");
  const facts = await macroMoveFacts(ctx, category.id);
  const counting = facts.byType[category.type] ?? 0n;
  const month = monthKey(today(ctx.timeZone));
  const [subscriptions, pockets, interests, limits, sources] = await Promise.all([
    chargesAmong(ctx, facts.movementIds),
    expensesAmong(ctx, facts.movementIds),
    postsUnderAny(ctx, facts.ids),
    getDb().transaction((tx) => limitsSnapshot(ctx, facts.ids, month, tx)),
    sourceNotes(ctx),
  ]);
  return {
    from: category.type,
    count: facts.countByType[category.type] ?? 0,
    amountCents: counting < 0n ? -counting : counting,
    firstYear: facts.firstYear,
    linked: { subscriptions, pockets, interests: interests ? (facts.countByType.income ?? 0) : 0 },
    stopsBudget: limits.rows.some((row) => !row.stopped),
    sources: [
      ...new Set(facts.ids.flatMap((one) => (sources.has(one) ? [sources.get(one)!.source] : []))),
    ].sort(),
  };
}

/** What "Undo" is asked with: kept by the browser, checked again here. */
export interface MacroMoveUndo {
  id: string;
  place: MacroPlace;
  limits: LimitsSnapshot | null;
}

/**
 * Moves a group, or a category of Transfers, to another macro. A move to Transfers stops its
 * budgets from this month (QC8). Returns what "Undo" needs.
 */
export async function moveToMacro(ctx: Who, id: string, place: unknown): Promise<MacroMoveUndo> {
  const month = monthKey(today(ctx.timeZone));
  const facts = await macroMoveFacts(ctx, id);
  const target = z.object({ type: z.string() }).safeParse(place);
  return getDb().transaction(async (tx) => {
    let limits: LimitsSnapshot | null = null;
    if (target.success && target.data.type === "transfer") {
      const before = await limitsSnapshot(ctx, facts.ids, month, tx);
      if ((await stopLimitsOf(ctx, facts.ids, month, tx)) > 0 || before.rows.length > 0) limits = before;
    }
    const left = await moveCategoryToMacro(ctx, facts.ids[0], place, tx);
    return { id: facts.ids[0], place: left, limits };
  });
}

const limitsSchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}-01$/),
  categoryIds: z.array(z.uuid()).max(500),
  rows: z
    .array(
      z.object({
        categoryId: z.uuid(),
        accountId: z.uuid().nullable(),
        fromMonth: z.string().regex(/^\d{4}-\d{2}-01$/),
        amountCents: z
          .string()
          .regex(/^-?\d{1,15}$/)
          .nullable(),
        stopped: z.boolean(),
      }),
    )
    .max(500),
});

const undoSchema = z.object({
  id: z.uuid(),
  place: z.object({ type: z.enum(["income", "expense", "transfer"]), parentId: z.uuid().nullable() }),
  limits: limitsSchema.nullable(),
});

/**
 * "Undo" of a move: the category goes back to its macro and place, and the budgets it stopped
 * come back. The limits are checked against the category's own ids and the person's accounts.
 */
export async function undoMoveToMacro(ctx: Who, input: unknown): Promise<void> {
  const undo = undoSchema.parse(input);
  const facts = await macroMoveFacts(ctx, undo.id);
  if (undo.limits) {
    const mine = new Set(facts.ids);
    const owned = new Set((await listAccounts(ctx, { includeArchived: true })).map((account) => account.id));
    const fits =
      undo.limits.categoryIds.every((one) => mine.has(one)) &&
      undo.limits.rows.every(
        (row) => mine.has(row.categoryId) && (row.accountId === null || owned.has(row.accountId)),
      );
    if (!fits) throw new TransactionError("invalid");
  }
  await getDb().transaction(async (tx) => {
    await moveCategoryToMacro(ctx, undo.id, undo.place, tx, { restoring: true });
    if (undo.limits) await restoreLimits(ctx, undo.limits as LimitsSnapshot, tx);
  });
}
