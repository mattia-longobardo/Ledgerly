// modules/transactions/categorize/service.ts — the automatic categories as a use case (rewrite
// plan, 04-now.md §4.4): learn from the confirmed labels, then give a category, a suggestion or
// nothing to the movements that have none. Every decision is in the pure files beside this one;
// this file reads what they need and writes what they answer. No network anywhere.
//
// Which accounts the cascade reads is the caller's to say (`categorisableAccountIds`): the
// movements of a source that gives its own categories are never among them, so nothing here can
// recategorise one.
import { and, desc, eq, gte, inArray, isNull, or, sql } from "drizzle-orm";
import type { Ctx } from "../../../platform/context";
import { getDb } from "../../../platform/db/client";
import { userScoped } from "../../../platform/db/scope";
import { AUTOMATIC_CATEGORY_ORIGINS } from "../rules";
import { categories, categoryGroupMarks, categoryMemory, categoryModels, transactions } from "../schema";
import { type CascadeMovement, type Decision, decide, groupCategories, type Knowledge } from "./cascade";
import {
  type Example,
  loadModel,
  type Model,
  outOfSampleInTurns,
  type StoredModel,
  storeModel,
  trainInTurns,
} from "./classifier";
import { type Confirmation, strictMemory } from "./memory";
import { DEFAULT_GROUPS } from "./tables";
import { applyRulesToNew } from "./user-rules-service";
import { memoryKey } from "./text";
import { type Thresholds, thresholdsFor } from "./thresholds";

type Who = Pick<Ctx, "userId">;

/** The most confirmed labels a model is trained from: the newest ones, enough for any history. */
const MAX_EXAMPLES = 20_000;
/** What is left on a row when a person replaces an automatic category: the threshold counts them. */
export const CORRECTED = "corrected";
const CORRECTIONS_WINDOW_DAYS = 30;
/** Fewer automatic categories than this in the window say nothing about how often they are wrong. */
const MIN_CORRECTIONS_BASE = 20;
const WRITE_CHUNK = 500;
/** How long a pass may run before its flag is taken for one left behind. */
const STALE_PASS_MS = 10 * 60_000;

/** A confirmed label is one a person or a source gave; a row with no origin predates the origins. */
const CONFIRMED = or(
  isNull(transactions.categoryOrigin),
  inArray(transactions.categoryOrigin, ["user", "provider"]),
);

interface Label extends Example {
  at: Date;
  updatedAt: Date;
}

async function confirmedLabels(ctx: Who): Promise<Label[]> {
  const rows = await getDb()
    .select({
      payee: transactions.payee,
      counterparty: transactions.counterpartyName,
      rawText: transactions.rawText,
      note: transactions.note,
      accountId: transactions.accountId,
      amountCents: transactions.amountCents,
      categoryId: transactions.categoryId,
      at: transactions.occurredAt,
      updatedAt: transactions.updatedAt,
    })
    .from(transactions)
    .innerJoin(categories, and(eq(categories.id, transactions.categoryId), isNull(categories.archivedAt)))
    .where(
      and(
        userScoped(ctx).owns(transactions),
        inArray(transactions.type, ["income", "expense"]),
        isNull(transactions.removedUpstreamAt),
        CONFIRMED,
      ),
    )
    .orderBy(desc(transactions.occurredAt), desc(transactions.id))
    .limit(MAX_EXAMPLES);
  return rows.map((row) => ({ ...row, categoryId: row.categoryId as string }));
}

/** The share of the automatic categories of the last 30 days that a person replaced. */
async function correctionRate(ctx: Who, now: Date): Promise<number> {
  const since = new Date(now.getTime() - CORRECTIONS_WINDOW_DAYS * 86_400_000);
  const [row] = await getDb()
    .select({
      corrected: sql<number>`count(*) filter (where ${transactions.categoryReason} = ${CORRECTED} and ${transactions.categoryOrigin} = 'user')::int`,
      automatic: sql<number>`count(*) filter (where ${transactions.categoryOrigin} in ('memory', 'model', 'table'))::int`,
    })
    .from(transactions)
    .where(and(userScoped(ctx).owns(transactions), gte(transactions.updatedAt, since)));
  const base = (row?.corrected ?? 0) + (row?.automatic ?? 0);
  return base < MIN_CORRECTIONS_BASE ? 0 : (row?.corrected ?? 0) / base;
}

/** The person's categories a movement may be given, and their category for each default group. */
async function categoriesOf(ctx: Who): Promise<Pick<Knowledge, "groupCategory" | "categoryKind">> {
  const [active, marks] = await Promise.all([
    getDb()
      .select({ id: categories.id, name: categories.name, type: categories.type })
      .from(categories)
      .where(and(userScoped(ctx).owns(categories), isNull(categories.archivedAt)))
      .orderBy(categories.name, categories.id),
    getDb()
      .select({ categoryId: categoryGroupMarks.categoryId, groupKey: categoryGroupMarks.groupKey })
      .from(categoryGroupMarks)
      .where(userScoped(ctx).owns(categoryGroupMarks))
      .orderBy(categoryGroupMarks.groupKey),
  ]);
  return {
    categoryKind: new Map(active.map((category) => [category.id, category.type])),
    groupCategory: groupCategories(
      DEFAULT_GROUPS,
      active,
      new Map(marks.map((mark) => [mark.categoryId, mark.groupKey])),
    ),
  };
}

type ModelRow = typeof categoryModels.$inferSelect;

async function modelRow(ctx: Who): Promise<ModelRow | null> {
  const [row] = await getDb().select().from(categoryModels).where(eq(categoryModels.userId, ctx.userId));
  return row ?? null;
}

async function setPreparing(ctx: Who, preparing: boolean): Promise<void> {
  await getDb()
    .insert(categoryModels)
    .values({ userId: ctx.userId, preparing })
    .onConflictDoUpdate({ target: categoryModels.userId, set: { preparing } });
}

/** Whether a pass of the cascade is running for the person: what a screen that waits reads. */
export async function isPreparing(ctx: Who): Promise<boolean> {
  return (await modelRow(ctx))?.preparing ?? false;
}

/**
 * What is known about the person without learning anything new: the stored memory, the stored
 * model and its thresholds. What a suggestion for one movement is made from.
 */
export async function storedKnowledge(ctx: Who): Promise<Knowledge> {
  const [own, row, memory] = await Promise.all([
    categoriesOf(ctx),
    modelRow(ctx),
    getDb()
      .select({ key: categoryMemory.key, categoryId: categoryMemory.categoryId })
      .from(categoryMemory)
      .where(eq(categoryMemory.userId, ctx.userId))
      .orderBy(categoryMemory.key),
  ]);
  return {
    ...own,
    memory: new Map(memory.map((one) => [one.key, one.categoryId])),
    model: row?.model ? loadModel(row.model as StoredModel) : null,
    thresholds: { automatic: row?.automaticThreshold ?? null, suggestion: row?.suggestionThreshold ?? null },
  };
}

/**
 * Learns from the confirmed labels: the memory is rewritten, and the model is trained again when a
 * label is new or changed since it was last trained — otherwise the stored one is the same model.
 * A prediction of the model is never among the labels (`CONFIRMED`).
 */
async function learn(
  ctx: Who,
  now: Date,
  train: boolean,
): Promise<{ knowledge: Knowledge; trained: boolean; examples: number }> {
  const [labels, own, stored] = await Promise.all([confirmedLabels(ctx), categoriesOf(ctx), modelRow(ctx)]);
  const confirmations: Confirmation[] = labels.map((label) => ({
    key: memoryKey(label),
    categoryId: label.categoryId,
    at: label.at,
  }));
  const memory = strictMemory(confirmations);
  const labelledThrough = labels.reduce<Date | null>(
    (latest, label) => (latest === null || label.updatedAt > latest ? label.updatedAt : latest),
    null,
  );

  let model: Model | null = stored?.model ? loadModel(stored.model as StoredModel) : null;
  let thresholds: Thresholds = {
    automatic: stored?.automaticThreshold ?? null,
    suggestion: stored?.suggestionThreshold ?? null,
  };
  // Not asked to train: the stored model is the one, whatever the labels say now.
  const unchanged =
    !train ||
    (stored !== null &&
      stored.trainedAt !== null &&
      stored.examples === labels.length &&
      (stored.labelledThrough?.getTime() ?? null) === (labelledThrough?.getTime() ?? null) &&
      (model !== null || stored.model === null));
  if (!unchanged) {
    model = await trainInTurns(labels);
    thresholds =
      model === null
        ? { automatic: null, suggestion: null }
        : thresholdsFor(await outOfSampleInTurns(labels), await correctionRate(ctx, now));
  }

  await getDb().transaction(async (tx) => {
    await tx.delete(categoryMemory).where(eq(categoryMemory.userId, ctx.userId));
    const rows = [...memory].map(([key, categoryId]) => ({
      userId: ctx.userId,
      key,
      categoryId,
      updatedAt: now,
    }));
    for (let at = 0; at < rows.length; at += WRITE_CHUNK) {
      await tx.insert(categoryMemory).values(rows.slice(at, at + WRITE_CHUNK));
    }
    if (!unchanged) {
      const values = {
        version: (stored?.version ?? 0) + 1,
        examples: labels.length,
        labelledThrough,
        automaticThreshold: thresholds.automatic,
        suggestionThreshold: thresholds.suggestion,
        model: model === null ? null : storeModel(model),
        trainedAt: now,
      };
      await tx
        .insert(categoryModels)
        .values({ userId: ctx.userId, ...values })
        .onConflictDoUpdate({ target: categoryModels.userId, set: values });
    }
  });
  return { knowledge: { ...own, memory, model, thresholds }, trained: !unchanged, examples: labels.length };
}

/** The columns a decision of the cascade writes on a movement. */
function columnsFor(decision: Decision, version: number) {
  if (decision.kind === "automatic") {
    return {
      categoryId: decision.categoryId,
      categoryOrigin: decision.origin,
      categoryConfidence: decision.confidence,
      categoryModelVersion: decision.origin === "model" ? version : null,
      suggestedCategoryId: null,
      categoryReason: decision.reason,
      categoryReasonParams: decision.params,
    };
  }
  return {
    categoryId: null,
    categoryOrigin: null,
    categoryConfidence: null,
    categoryModelVersion: null,
    suggestedCategoryId: decision.kind === "suggestion" ? decision.categoryId : null,
    categoryReason: decision.kind === "suggestion" ? decision.reason : null,
    categoryReasonParams: decision.kind === "suggestion" ? decision.params : null,
  };
}

export interface CategoriseOutcome {
  /** Whether the model was trained again in this pass. */
  trained: boolean;
  /** How many confirmed labels there were to learn from. */
  examples: number;
  automatic: number;
  suggested: number;
  /** Movements read and left with no category and no suggestion. */
  open: number;
}

/**
 * One pass of the cascade over the movements of `accountIds` that have no category: learn, then
 * decide each one. With `train: false` the memory is rewritten from the labels and the model is the
 * stored one: what a pass after a person's correction does — the memory follows at once, the
 * model is trained again at the next reading of a source, not once for every click. A movement with a category — a person's, a source's or an automatic one given
 * before — is never read again, and neither is one a person set back to "no category": Ledgerly
 * never writes over a choice.
 */
export async function categorise(
  ctx: Who,
  accountIds: readonly string[],
  options: { now?: Date; train?: boolean } = {},
): Promise<CategoriseOutcome> {
  const now = options.now ?? new Date();
  const outcome: CategoriseOutcome = { trained: false, examples: 0, automatic: 0, suggested: 0, open: 0 };
  if (accountIds.length === 0) return outcome;
  // One pass at a time for a person: a second one started while the first runs would do the same
  // arithmetic again. A flag left behind by a process that stopped is ignored after a while.
  const running = await modelRow(ctx);
  if (running?.preparing && now.getTime() - running.updatedAt.getTime() < STALE_PASS_MS) return outcome;
  await setPreparing(ctx, true);
  try {
    const { knowledge, trained, examples } = await learn(ctx, now, options.train ?? true);
    outcome.trained = trained;
    outcome.examples = examples;
    const version = (await modelRow(ctx))?.version ?? 0;

    const candidates = await getDb()
      .select({
        id: transactions.id,
        payee: transactions.payee,
        counterparty: transactions.counterpartyName,
        rawText: transactions.rawText,
        note: transactions.note,
        accountId: transactions.accountId,
        amountCents: transactions.amountCents,
        type: transactions.type,
        merchantCategoryCode: transactions.merchantCategoryCode,
        bankTransactionCode: transactions.bankTransactionCode,
        currency: transactions.currency,
        origin: transactions.origin,
        transferGroupId: transactions.transferGroupId,
      })
      .from(transactions)
      .where(
        and(
          userScoped(ctx).owns(transactions),
          inArray(transactions.accountId, [...accountIds]),
          inArray(transactions.type, ["income", "expense"]),
          isNull(transactions.categoryId),
          isNull(transactions.categoryOrigin),
          isNull(transactions.removedUpstreamAt),
        ),
      )
      .orderBy(transactions.id);

    // The person's rules come first (categories-and-rules.md §4.5): the movements one decided are done.
    const byRule = await applyRulesToNew(ctx, candidates);
    outcome.automatic += byRule.size;
    const writes = candidates
      .filter((row) => !byRule.has(row.id))
      .map((row) => {
        const movement: CascadeMovement = { ...row, kind: row.type === "income" ? "income" : "expense" };
        const decision = decide(movement, knowledge);
        if (decision.kind === "automatic") outcome.automatic += 1;
        else if (decision.kind === "suggestion") outcome.suggested += 1;
        else outcome.open += 1;
        return { id: row.id, values: { ...columnsFor(decision, version), categoryKey: memoryKey(movement) } };
      });
    for (let at = 0; at < writes.length; at += WRITE_CHUNK) {
      await getDb().transaction(async (tx) => {
        for (const write of writes.slice(at, at + WRITE_CHUNK)) {
          await tx
            .update(transactions)
            .set(write.values)
            // Still with no category: a choice a person made while the pass ran is not written over.
            .where(
              and(
                eq(transactions.id, write.id),
                userScoped(ctx).owns(transactions),
                isNull(transactions.categoryId),
                isNull(transactions.categoryOrigin),
              ),
            );
        }
      });
    }
    return outcome;
  } finally {
    await setPreparing(ctx, false);
  }
}

/**
 * The category the cascade would give one movement that is not written yet — the dialog of a
 * manual movement — from what is already known, with nothing learnt and nothing written. Automatic
 * or suggested, it is a suggestion here: the person sees it before they save.
 */
export async function suggestFor(
  ctx: Who,
  movement: CascadeMovement,
): Promise<{ categoryId: string; reason: string } | null> {
  const decision = decide(movement, await storedKnowledge(ctx));
  return decision.kind === "none" ? null : { categoryId: decision.categoryId, reason: decision.reason };
}

/** The origins the cascade writes, for the queries that tell an automatic category from a chosen one. */
export const AUTOMATIC_ORIGINS_SQL = AUTOMATIC_CATEGORY_ORIGINS;
