/**
 * Labels with no movement (PERS-634, decision 13A): the categorised rows of an export of the app a
 * person used before, kept for the classifier and the memory to learn from (`category_labels`).
 * The import runs once, from the worker (`--import-labels`): no route reads a file.
 */
import { and, desc, eq, gte, inArray, isNull, lte } from "drizzle-orm";
import type { Ctx } from "../../../platform/context";
import { getDb } from "../../../platform/db/client";
import { userScoped } from "../../../platform/db/scope";
import { decodeText, detectDelimiter, parseRecords } from "../rules/csv";
import { categories, categoryLabels, transactions } from "../schema";
import { categoryForName, exportLabels } from "../rules/export-labels";
import { setCategory } from "./edits";
import { categoriesOf } from "./own-categories";

type Who = Pick<Ctx, "userId">;

/** The most labels kept, as the most confirmed labels a model is trained from. */
const MAX_LABELS = 20_000;
const WRITE_CHUNK = 500;

/** The labels imported with no movement (PERS-634), as confirmed labels with no account. */
export async function importedLabels(ctx: Who) {
  const rows = await getDb()
    .select({
      categoryId: categoryLabels.categoryId,
      kind: categoryLabels.kind,
      payee: categoryLabels.payee,
      note: categoryLabels.note,
      amountCents: categoryLabels.amountCents,
      at: categoryLabels.occurredAt,
      updatedAt: categoryLabels.createdAt,
    })
    .from(categoryLabels)
    .innerJoin(categories, and(eq(categories.id, categoryLabels.categoryId), isNull(categories.archivedAt)))
    .where(userScoped(ctx).owns(categoryLabels))
    .orderBy(desc(categoryLabels.occurredAt), desc(categoryLabels.id))
    .limit(MAX_LABELS);
  return rows.map((row) => ({
    ...row,
    counterparty: null,
    rawText: null,
    accountId: "",
    merchantCategoryCode: null,
    bankTransactionCode: null,
  }));
}

/** What an import of labels did: counts only. */
export interface LabelsImport {
  /** Labels kept: the classifier and the memory learn from them. */
  imported: number;
  /** Labels that are one movement here: the movement takes the export's category, as the person's. */
  categorised: number;
  /** Labels that are one movement here whose category the person chose by hand: left as it is. */
  keptByHand: number;
  /** Labels near more than one movement of the same amount, or sharing one: a label only. */
  ambiguous: number;
  transfers: number;
  unknown: number;
  unreadable: number;
  /** A category of the export with no category of the person's to match it. */
  unmapped: number;
}

const EXPORT = "export";
/** The largest export the import reads. */
const MAX_BYTES = 5 * 1024 * 1024;
/** How far apart, in days, a row of the export and a movement of the same amount are one payment. */
const SAME_PAYMENT_DAYS = 3;
const DAY_MS = 86_400_000;

interface Label {
  userId: string;
  source: string;
  categoryId: string;
  kind: "income" | "expense";
  payee: string | null;
  note: string | null;
  amountCents: bigint;
  occurredAt: Date;
}

/**
 * The labels of an export (decision 13A): every row a person categorised there becomes a label the
 * classifier and the memory learn from, under the person's category of the same name and sign. A
 * row that is one movement here — the same sign and amount within `SAME_PAYMENT_DAYS`, the only
 * one on both sides — also gives that movement its category, as the person's choice, unless the
 * person chose one by hand; a giroconto is never touched. No movement is created. A new import
 * replaces the labels of the last. `null`: the file is not such an export. The caller trains.
 */
export async function importCategoryLabels(ctx: Who, bytes: Uint8Array): Promise<LabelsImport | null> {
  if (bytes.byteLength > MAX_BYTES) throw new LabelsImportError("too_large");
  const text = decodeText(bytes);
  const rows = exportLabels(parseRecords(text, detectDelimiter(text)));
  if (rows === null) return null;
  if (rows.labels.length > MAX_LABELS) throw new LabelsImportError("too_many_rows");
  const own = await categoriesOf(ctx);
  const outcome: LabelsImport = {
    imported: 0,
    categorised: 0,
    keptByHand: 0,
    ambiguous: 0,
    transfers: rows.transfers,
    unknown: rows.unknown,
    unreadable: rows.unreadable,
    unmapped: 0,
  };
  const values: Label[] = rows.labels.flatMap((label) => {
    const categoryId = categoryForName(label.category, label.kind, own.groupCategory, own.named);
    if (categoryId === null) {
      outcome.unmapped += 1;
      return [];
    }
    return [
      {
        userId: ctx.userId,
        source: EXPORT,
        categoryId,
        kind: label.kind,
        payee: label.payee,
        note: label.note,
        amountCents: label.amountCents,
        occurredAt: label.at,
      },
    ];
  });
  await replaceLabels(ctx, values);
  outcome.imported = values.length;
  await fileMatches(ctx, values, outcome);
  return outcome;
}

async function replaceLabels(ctx: Who, values: readonly Label[]): Promise<void> {
  await getDb().transaction(async (write) => {
    await write
      .delete(categoryLabels)
      .where(and(userScoped(ctx).owns(categoryLabels), eq(categoryLabels.source, EXPORT)));
    for (let start = 0; start < values.length; start += WRITE_CHUNK) {
      await write.insert(categoryLabels).values(values.slice(start, start + WRITE_CHUNK));
    }
  });
}

/** Gives each label's one movement the label's category, as the person's choice (see the import). */
async function fileMatches(ctx: Who, labels: readonly Label[], outcome: LabelsImport): Promise<void> {
  const near = await movementsNear(ctx, labels);
  const matches = pairsOf(labels, near);
  outcome.ambiguous = matches.ambiguous;
  const byCategory = new Map<string, string[]>();
  for (const [label, movement] of matches.pairs) {
    if (movement.categoryOrigin === "user") {
      outcome.keptByHand += 1;
      continue;
    }
    byCategory.set(label.categoryId, [...(byCategory.get(label.categoryId) ?? []), movement.id]);
  }
  for (const [categoryId, ids] of byCategory) {
    outcome.categorised += await setCategory(ctx, ids, categoryId);
  }
}

interface Near {
  id: string;
  amountCents: bigint;
  at: Date;
  categoryOrigin: string | null;
}

/** The person's incomes and spendings of the export's days: never a giroconto, a hidden or a gone row. */
async function movementsNear(ctx: Who, labels: readonly Label[]): Promise<Near[]> {
  if (labels.length === 0) return [];
  const times = labels.map((label) => label.occurredAt.getTime());
  return getDb()
    .select({
      id: transactions.id,
      amountCents: transactions.amountCents,
      at: transactions.occurredAt,
      categoryOrigin: transactions.categoryOrigin,
    })
    .from(transactions)
    .where(
      and(
        userScoped(ctx).owns(transactions),
        inArray(transactions.type, ["income", "expense"]),
        isNull(transactions.hiddenAt),
        isNull(transactions.removedUpstreamAt),
        gte(transactions.occurredAt, new Date(Math.min(...times) - SAME_PAYMENT_DAYS * DAY_MS)),
        lte(transactions.occurredAt, new Date(Math.max(...times) + SAME_PAYMENT_DAYS * DAY_MS)),
      ),
    );
}

/**
 * The label–movement pairs that are sure: the same amount (and so the same sign) within
 * `SAME_PAYMENT_DAYS`, and the only candidate on both sides. A label with candidates that is not
 * such a pair is `ambiguous`.
 */
function pairsOf<
  L extends { amountCents: bigint; occurredAt: Date },
  M extends { id: string; amountCents: bigint; at: Date },
>(labels: readonly L[], movements: readonly M[]): { pairs: [L, M][]; ambiguous: number } {
  const byAmount = new Map<bigint, M[]>();
  for (const movement of movements) {
    byAmount.set(movement.amountCents, [...(byAmount.get(movement.amountCents) ?? []), movement]);
  }
  const candidates = labels.map((label) =>
    (byAmount.get(label.amountCents) ?? []).filter(
      (movement) =>
        Math.abs(movement.at.getTime() - label.occurredAt.getTime()) <= SAME_PAYMENT_DAYS * DAY_MS,
    ),
  );
  const claims = new Map<string, number>();
  for (const found of candidates)
    for (const movement of found) claims.set(movement.id, (claims.get(movement.id) ?? 0) + 1);
  const pairs: [L, M][] = [];
  let ambiguous = 0;
  candidates.forEach((found, index) => {
    if (found.length === 1 && claims.get(found[0].id) === 1) pairs.push([labels[index], found[0]]);
    else if (found.length > 0) ambiguous += 1;
  });
  return { pairs, ambiguous };
}

/** A file the import refuses before it reads a row. */
export class LabelsImportError extends Error {
  constructor(readonly code: "too_large" | "too_many_rows") {
    super(code);
    this.name = "LabelsImportError";
  }
}
