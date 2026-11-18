/**
 * The movements' side of moving an account from one source to another (rewrite plan N4, 04-now.md
 * §4.6 and §4.6.1): what the comparison reads, the transfers of the switch and how they go back,
 * the bank's links on the movements found in both sources, and the bank's rows after an undo. The
 * rules are pure, in `switch-rules.ts`; the use case is in the application.
 */
import "server-only";
import { and, asc, eq, inArray, isNull, ne, notExists, sql } from "drizzle-orm";
import type { Ctx } from "@/platform/context";
import { type CivilDate, civilDateIn } from "@/platform/dates";
import { getDb, type Tx } from "@/platform/db/client";
import { userScoped } from "@/platform/db/scope";
import { providerLinks } from "@/platform/integrations/schema";
import { linkExternal } from "@/platform/integrations/service";
import { retypeMovements } from "./macro";
import { markLocallyEdited } from "./rules";
import { chosenBy } from "./service";
import {
  type DoubleMatch,
  type SwitchMovement,
  takesFromDouble,
  type TransferCandidate,
  type TransferPair,
} from "./switch-rules";
import {
  type MergedMovementBefore,
  switchMergedMovements,
  switchTransferPairs,
  transactions,
} from "./schema";

type Who = Pick<Ctx, "userId" | "timeZone">;

/** A row that counts: not hidden by the person, not gone from its source. */
const visible = () => and(isNull(transactions.hiddenAt), isNull(transactions.removedUpstreamAt));

/** The text two sources both keep of a movement. */
function textOf(row: { payee: string | null; note: string | null }): string {
  return `${row.payee ?? ""} ${row.note ?? ""}`.trim();
}

/**
 * The movements of an account from `from` to `to` (days in the person's zone), as the comparison of
 * the switch reads them (§4.6): money in and out written by the source, not transfers, visible.
 */
export async function movementsToCompare(
  ctx: Who,
  accountId: string,
  from: CivilDate,
  to: CivilDate,
): Promise<SwitchMovement[]> {
  const rows = await getDb()
    .select({
      id: transactions.id,
      occurredAt: transactions.occurredAt,
      amountCents: transactions.amountCents,
      payee: transactions.payee,
      note: transactions.note,
    })
    .from(transactions)
    .where(
      and(
        userScoped(ctx).owns(transactions),
        eq(transactions.accountId, accountId),
        eq(transactions.origin, "provider"),
        visible(),
      ),
    )
    .orderBy(asc(transactions.occurredAt), asc(transactions.id));
  return rows.flatMap((row) => {
    const day = civilDateIn(row.occurredAt, ctx.timeZone);
    return day >= from && day <= to
      ? [{ id: row.id, day, amountCents: row.amountCents, text: textOf(row) }]
      : [];
  });
}

/**
 * The movements of these accounts that may become a leg of a transfer (§4.6.1, point 10): money in
 * or out, not already a transfer, visible. A movement with a category chosen by the person is
 * included: the report says so (`categoryByPerson`).
 */
export async function transferCandidates(
  ctx: Who,
  accountIds: readonly string[],
  since: CivilDate | null = null,
): Promise<(TransferCandidate & { categoryByPerson: boolean })[]> {
  if (accountIds.length === 0) return [];
  const rows = await getDb()
    .select({
      id: transactions.id,
      accountId: transactions.accountId,
      occurredAt: transactions.occurredAt,
      amountCents: transactions.amountCents,
      currency: transactions.currency,
      categoryOrigin: transactions.categoryOrigin,
    })
    .from(transactions)
    .where(
      and(
        userScoped(ctx).owns(transactions),
        inArray(transactions.accountId, [...accountIds]),
        ne(transactions.type, "transfer"),
        isNull(transactions.transferGroupId),
        visible(),
      ),
    )
    .orderBy(asc(transactions.occurredAt), asc(transactions.id));
  return rows.flatMap((row) => {
    const day = civilDateIn(row.occurredAt, ctx.timeZone);
    if (since !== null && day <= since) return [];
    return [
      {
        id: row.id,
        accountId: row.accountId,
        day,
        amountCents: row.amountCents,
        currency: row.currency,
        categoryByPerson: row.categoryOrigin === "user",
      },
    ];
  });
}

/**
 * Makes each pair a transfer (H40): both legs get the type `transfer` and one group, the smaller id,
 * as the provider's pairs. What each leg was is kept, for "Undo switch". Inside the caller's
 * transaction. A leg that is no longer free (another pass made it a transfer) is left alone.
 */
export async function writeTransferPairs(
  tx: Tx,
  ctx: Pick<Ctx, "userId">,
  switchId: string,
  pairs: readonly TransferPair[],
): Promise<number> {
  let written = 0;
  for (const pair of pairs) {
    const legs = await tx
      .select({ id: transactions.id, type: transactions.type, transferGroupId: transactions.transferGroupId })
      .from(transactions)
      .where(and(inArray(transactions.id, [pair.outId, pair.inId]), userScoped(ctx).owns(transactions)))
      .for("update");
    const out = legs.find((leg) => leg.id === pair.outId);
    const into = legs.find((leg) => leg.id === pair.inId);
    if (!out || !into || out.type === "transfer" || into.type === "transfer") continue;
    if (out.transferGroupId !== null || into.transferGroupId !== null) continue;
    const group = pair.outId < pair.inId ? pair.outId : pair.inId;
    await tx
      .update(transactions)
      .set({ type: "transfer", transferGroupId: group })
      .where(and(inArray(transactions.id, [pair.outId, pair.inId]), userScoped(ctx).owns(transactions)));
    await tx.insert(switchTransferPairs).values(
      userScoped(ctx).stamp({
        switchId,
        outId: pair.outId,
        inId: pair.inId,
        outBefore: { type: out.type, transferGroupId: out.transferGroupId },
        inBefore: { type: into.type, transferGroupId: into.transferGroupId },
      }),
    );
    written += 1;
  }
  return written;
}

/** "Undo switch": every pair of the switch goes back to a money in and a money out, as it was. */
export async function undoTransferPairs(
  tx: Tx,
  ctx: Pick<Ctx, "userId">,
  switchId: string,
  now: Date,
): Promise<number> {
  const pairs = await tx
    .select()
    .from(switchTransferPairs)
    .where(
      and(
        eq(switchTransferPairs.switchId, switchId),
        isNull(switchTransferPairs.undoneAt),
        userScoped(ctx).owns(switchTransferPairs),
      ),
    );
  for (const pair of pairs) {
    for (const [id, before] of [
      [pair.outId, pair.outBefore],
      [pair.inId, pair.inBefore],
    ] as const) {
      await tx
        .update(transactions)
        .set({ type: before.type, transferGroupId: before.transferGroupId })
        .where(and(eq(transactions.id, id), userScoped(ctx).owns(transactions)));
    }
  }
  await tx
    .update(switchTransferPairs)
    .set({ undoneAt: now })
    .where(and(eq(switchTransferPairs.switchId, switchId), isNull(switchTransferPairs.undoneAt)));
  // A leg out of its pair counts by its category (CR3).
  await retypeMovements(tx, ctx);
  return pairs.length;
}

/**
 * The movements found in both sources keep their row and get the bank's link too (§9.1): the next
 * reading of the bank recognises them and creates nothing. Inside the caller's transaction.
 */
export async function linkFoundInBoth(
  tx: Tx,
  ctx: Pick<Ctx, "userId">,
  provider: string,
  links: readonly { transactionId: string; externalId: string }[],
  now: Date,
): Promise<void> {
  for (const link of links) {
    await linkExternal(
      ctx,
      { provider, entityType: "transaction", entityId: link.transactionId, externalId: link.externalId },
      now,
      tx,
    );
  }
}

/**
 * "Undo switch" for the movements (H41): the bank's links on the account's rows go; a row the bank
 * brought (no link of the source of before) no longer counts and is not shown — `removed_upstream_at`,
 * which no reading and no person takes away. No row is deleted. Returns how many rows were retired.
 */
export async function retireBankRows(
  tx: Tx,
  ctx: Pick<Ctx, "userId">,
  input: { accountId: string; bankProvider: string; sourceProvider: string },
  now: Date,
): Promise<number> {
  const ofBank = sql`exists (select 1 from ${providerLinks} l where l.entity_type = 'transaction' and l.entity_id = ${transactions.id} and l.provider = ${input.bankProvider})`;
  const retired = await tx
    .update(transactions)
    .set({ removedUpstreamAt: now })
    .where(
      and(
        userScoped(ctx).owns(transactions),
        eq(transactions.accountId, input.accountId),
        isNull(transactions.removedUpstreamAt),
        ofBank,
        notExists(
          tx
            .select({ one: sql`1` })
            .from(providerLinks)
            .where(
              and(
                eq(providerLinks.entityType, "transaction"),
                eq(providerLinks.entityId, transactions.id),
                eq(providerLinks.provider, input.sourceProvider),
              ),
            ),
        ),
      ),
    )
    .returning({ id: transactions.id });
  await tx.delete(providerLinks).where(
    and(
      userScoped(ctx).owns(providerLinks),
      eq(providerLinks.provider, input.bankProvider),
      eq(providerLinks.entityType, "transaction"),
      inArray(
        providerLinks.entityId,
        tx
          .select({ id: transactions.id })
          .from(transactions)
          .where(and(eq(transactions.accountId, input.accountId), userScoped(ctx).owns(transactions))),
      ),
    ),
  );
  return retired.length;
}

/** The pairs of a switch still in force, for its page and its count. */
export async function openPairsOf(ctx: Pick<Ctx, "userId">, switchId: string): Promise<number> {
  const [row] = await getDb()
    .select({ count: sql<number>`count(*)::int` })
    .from(switchTransferPairs)
    .where(
      and(
        eq(switchTransferPairs.switchId, switchId),
        isNull(switchTransferPairs.undoneAt),
        userScoped(ctx).owns(switchTransferPairs),
      ),
    );
  return row?.count ?? 0;
}

/**
 * The movements of an account of the bank already here, as a switch that joins it reads them (H39
 * for already imported accounts): every row that still counts for its source, hidden or not.
 * `manual` counts the rows a person wrote by hand: a switch does not join an account that has any.
 */
export async function doubleMovements(
  ctx: Who,
  accountId: string,
): Promise<{ movements: SwitchMovement[]; manual: number }> {
  const rows = await getDb()
    .select({
      id: transactions.id,
      occurredAt: transactions.occurredAt,
      amountCents: transactions.amountCents,
      payee: transactions.payee,
      note: transactions.note,
      origin: transactions.origin,
    })
    .from(transactions)
    .where(
      and(
        userScoped(ctx).owns(transactions),
        eq(transactions.accountId, accountId),
        isNull(transactions.removedUpstreamAt),
      ),
    )
    .orderBy(asc(transactions.occurredAt), asc(transactions.id));
  return {
    movements: rows
      .filter((row) => row.origin === "provider")
      .map((row) => ({
        id: row.id,
        day: civilDateIn(row.occurredAt, ctx.timeZone),
        amountCents: row.amountCents,
        text: textOf(row),
      })),
    manual: rows.filter((row) => row.origin !== "provider").length,
  };
}

/** What `takesFromDouble` reads of a movement, and what "Undo switch" puts back. */
const choiceColumns = {
  id: transactions.id,
  categoryId: transactions.categoryId,
  categoryOrigin: transactions.categoryOrigin,
  categoryConfidence: transactions.categoryConfidence,
  categoryModelVersion: transactions.categoryModelVersion,
  suggestedCategoryId: transactions.suggestedCategoryId,
  categoryReason: transactions.categoryReason,
  categoryReasonParams: transactions.categoryReasonParams,
  note: transactions.note,
  locallyEdited: transactions.locallyEdited,
};

async function choicesOf(executor: Tx | ReturnType<typeof getDb>, ctx: Pick<Ctx, "userId">, ids: string[]) {
  if (ids.length === 0) return new Map<string, MergedMovementBefore & { id: string }>();
  const rows = await executor
    .select(choiceColumns)
    .from(transactions)
    .where(and(inArray(transactions.id, ids), userScoped(ctx).owns(transactions)));
  return new Map(rows.map((row) => [row.id, { ...row, locallyEdited: [...row.locallyEdited] }]));
}

/** How many categories and notes of the person a join would carry to the movements kept. */
export async function choicesToCarry(
  ctx: Pick<Ctx, "userId">,
  pairs: readonly DoubleMatch[],
): Promise<{ categories: number; notes: number }> {
  const rows = await choicesOf(
    getDb(),
    ctx,
    pairs.flatMap((pair) => [pair.doubleId, pair.keptId]),
  );
  let categories = 0;
  let notes = 0;
  for (const pair of pairs) {
    const double = rows.get(pair.doubleId);
    const kept = rows.get(pair.keptId);
    if (!double || !kept) continue;
    const takes = takesFromDouble(double, kept);
    if (takes.category) categories += 1;
    if (takes.note) notes += 1;
  }
  return { categories, notes };
}

/**
 * Joins the movements of the bank's account already here to the switched account's (H39 for already
 * imported accounts): each double gives its bank link to the movement it repeats, and the person's
 * category and note when that movement has none; then it no longer counts (`removed_upstream_at`).
 * No row is deleted; each step is recorded for "Undo switch". Inside the caller's transaction.
 * Returns the bank ids that moved, so the comparison of the period does not link them twice.
 */
export async function joinDoubles(
  tx: Tx,
  ctx: Pick<Ctx, "userId">,
  input: { switchId: string; bankProvider: string; pairs: readonly DoubleMatch[] },
  now: Date,
): Promise<{ externalIds: Set<string>; keptIds: Set<string> }> {
  const moved = { externalIds: new Set<string>(), keptIds: new Set<string>() };
  if (input.pairs.length === 0) return moved;
  const rows = await choicesOf(
    tx,
    ctx,
    input.pairs.flatMap((pair) => [pair.doubleId, pair.keptId]),
  );
  const links = await tx
    .select({ entityId: providerLinks.entityId, externalId: providerLinks.externalId })
    .from(providerLinks)
    .where(
      and(
        userScoped(ctx).owns(providerLinks),
        eq(providerLinks.provider, input.bankProvider),
        eq(providerLinks.entityType, "transaction"),
        inArray(
          providerLinks.entityId,
          input.pairs.map((pair) => pair.doubleId),
        ),
      ),
    );
  const externalOf = new Map(links.map((link) => [link.entityId, link.externalId]));
  for (const pair of input.pairs) {
    const double = rows.get(pair.doubleId);
    const kept = rows.get(pair.keptId);
    if (!double || !kept) throw new Error("a movement of the join is gone");
    const takes = takesFromDouble(double, kept);
    const edited: ("categoryId" | "note")[] = [];
    if (takes.category) edited.push("categoryId");
    if (takes.note) edited.push("note");
    if (edited.length > 0) {
      await tx
        .update(transactions)
        .set({
          ...(takes.category ? { categoryId: double.categoryId, ...chosenBy("user") } : {}),
          ...(takes.note ? { note: double.note } : {}),
          locallyEdited: markLocallyEdited(kept.locallyEdited, edited),
          updatedAt: now,
        })
        .where(and(eq(transactions.id, kept.id), userScoped(ctx).owns(transactions)));
    }
    await tx
      .update(transactions)
      .set({ removedUpstreamAt: now })
      .where(and(eq(transactions.id, double.id), userScoped(ctx).owns(transactions)));
    const externalId = externalOf.get(double.id) ?? null;
    if (externalId !== null) {
      // The link is unique by the bank's id: writing it on the movement kept moves it there.
      await linkExternal(
        ctx,
        { provider: input.bankProvider, entityType: "transaction", entityId: kept.id, externalId },
        now,
        tx,
      );
      moved.externalIds.add(externalId);
    }
    moved.keptIds.add(kept.id);
    const before: MergedMovementBefore = {
      categoryId: kept.categoryId,
      categoryOrigin: kept.categoryOrigin,
      categoryConfidence: kept.categoryConfidence,
      categoryModelVersion: kept.categoryModelVersion,
      suggestedCategoryId: kept.suggestedCategoryId,
      categoryReason: kept.categoryReason,
      categoryReasonParams: kept.categoryReasonParams,
      note: kept.note,
      locallyEdited: kept.locallyEdited,
    };
    await tx.insert(switchMergedMovements).values(
      userScoped(ctx).stamp({
        switchId: input.switchId,
        doubleId: double.id,
        keptId: kept.id,
        externalId,
        keptBefore: edited.length > 0 ? before : null,
      }),
    );
  }
  await retypeMovements(tx, ctx);
  return moved;
}

/**
 * "Undo switch" for a join: each bank link goes back to its double, the double counts again, and a
 * movement kept gets back what it had — only when it still holds what the double gave it, so a
 * later choice of the person stays. Inside the caller's transaction, before `retireBankRows`.
 */
export async function undoJoinedDoubles(
  tx: Tx,
  ctx: Pick<Ctx, "userId">,
  input: { switchId: string; bankProvider: string },
  now: Date,
): Promise<number> {
  const records = await tx
    .select()
    .from(switchMergedMovements)
    .where(
      and(
        eq(switchMergedMovements.switchId, input.switchId),
        isNull(switchMergedMovements.undoneAt),
        userScoped(ctx).owns(switchMergedMovements),
      ),
    );
  if (records.length === 0) return 0;
  const rows = await choicesOf(
    tx,
    ctx,
    records.flatMap((record) => [record.doubleId, record.keptId]),
  );
  for (const record of records) {
    if (record.externalId !== null) {
      await linkExternal(
        ctx,
        {
          provider: input.bankProvider,
          entityType: "transaction",
          entityId: record.doubleId,
          externalId: record.externalId,
        },
        now,
        tx,
      );
    }
    await tx
      .update(transactions)
      .set({ removedUpstreamAt: null })
      .where(and(eq(transactions.id, record.doubleId), userScoped(ctx).owns(transactions)));
    const before = record.keptBefore;
    const double = rows.get(record.doubleId);
    const kept = rows.get(record.keptId);
    if (before === null || !double || !kept) continue;
    const categoryStays = kept.categoryOrigin === "user" && kept.categoryId === double.categoryId;
    const noteStays = kept.note === double.note;
    const back = {
      ...(categoryStays && before.categoryId !== kept.categoryId
        ? {
            categoryId: before.categoryId,
            categoryOrigin: before.categoryOrigin,
            categoryConfidence: before.categoryConfidence,
            categoryModelVersion: before.categoryModelVersion,
            suggestedCategoryId: before.suggestedCategoryId,
            categoryReason: before.categoryReason,
            categoryReasonParams: before.categoryReasonParams,
          }
        : {}),
      ...(noteStays && before.note !== kept.note ? { note: before.note } : {}),
    };
    if (Object.keys(back).length === 0) continue;
    // A field the join marked as the person's goes back to unmarked with its value.
    const edited = kept.locallyEdited.filter(
      (field) => !(field in back) || before.locallyEdited.includes(field),
    );
    await tx
      .update(transactions)
      .set({ ...back, locallyEdited: edited, updatedAt: now })
      .where(and(eq(transactions.id, kept.id), userScoped(ctx).owns(transactions)));
  }
  await tx
    .update(switchMergedMovements)
    .set({ undoneAt: now })
    .where(and(eq(switchMergedMovements.switchId, input.switchId), isNull(switchMergedMovements.undoneAt)));
  await retypeMovements(tx, ctx);
  return records.length;
}
