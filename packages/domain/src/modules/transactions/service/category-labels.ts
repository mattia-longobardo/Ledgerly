/**
 * Labels with no movement (PERS-634, decision 13A): the categorised rows of an export of the app a
 * person used before, kept for the classifier and the memory to learn from (`category_labels`).
 */
import { and, desc, eq, gte, inArray, isNull, lte } from "drizzle-orm";
import { LABELS_MAX_BYTES } from "@ledgerly/api-contract";
import type { Ctx } from "../../../platform/context";
import { getDb } from "../../../platform/db/client";
import { userScoped } from "../../../platform/db/scope";
import { decodeText, detectDelimiter, parseRecords } from "../rules/csv";
import { categories, categoryLabels, transactions } from "../schema";
import { categoryForName, exportLabels } from "../rules/export-labels";
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

/** What an import of labels did (PERS-634): counts only. */
export interface LabelsImport {
  /** Labels kept: the classifier and the memory learn from them. */
  imported: number;
  transfers: number;
  unknown: number;
  unreadable: number;
  /** A category of the export with no category of the person's to match it. */
  unmapped: number;
  /** A row that is already a movement here, by sign, amount and day: learnt from the movement. */
  duplicates: number;
}

const EXPORT = "export";
/** How far apart, in days, a row of the export and a movement of the same amount are one payment. */
const SAME_PAYMENT_DAYS = 3;
const DAY_MS = 86_400_000;

/**
 * The labels of an export (PERS-634, decision 13A): every row a person categorised there
 * becomes a label the classifier and the memory learn from, under the person's category of the same
 * name and sign. No movement is written. A row that is already a movement here — the same sign and
 * amount within `SAME_PAYMENT_DAYS` — is left out, so one payment is not learnt twice. A new import
 * replaces the labels of the last. `null`: the file is not such an export. The caller trains.
 */
export async function importCategoryLabels(ctx: Who, bytes: Uint8Array): Promise<LabelsImport | null> {
  if (bytes.byteLength > LABELS_MAX_BYTES) throw new LabelsImportError("too_large");
  const text = decodeText(bytes);
  const rows = exportLabels(parseRecords(text, detectDelimiter(text)));
  if (rows === null) return null;
  if (rows.labels.length > MAX_LABELS) throw new LabelsImportError("too_many_rows");
  const own = await categoriesOf(ctx);
  const outcome: LabelsImport = {
    imported: 0,
    transfers: rows.transfers,
    unknown: rows.unknown,
    unreadable: rows.unreadable,
    unmapped: 0,
    duplicates: 0,
  };
  const taken = await movementsAround(ctx, rows.labels);
  const values = rows.labels.flatMap((label) => {
    const categoryId = categoryForName(label.category, label.kind, own.groupCategory, own.named);
    if (categoryId === null) {
      outcome.unmapped += 1;
      return [];
    }
    if (takeSamePayment(taken, label)) {
      outcome.duplicates += 1;
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
  await getDb().transaction(async (write) => {
    await write
      .delete(categoryLabels)
      .where(and(userScoped(ctx).owns(categoryLabels), eq(categoryLabels.source, EXPORT)));
    for (let start = 0; start < values.length; start += WRITE_CHUNK) {
      await write.insert(categoryLabels).values(values.slice(start, start + WRITE_CHUNK));
    }
  });
  outcome.imported = values.length;
  return outcome;
}

/** A file the import refuses before it reads a row. */
export class LabelsImportError extends Error {
  constructor(readonly code: "too_large" | "too_many_rows") {
    super(code);
    this.name = "LabelsImportError";
  }
}

/** The person's movements of the export's days, by sign and amount: each matches one row at most. */
async function movementsAround(
  ctx: Who,
  labels: readonly { amountCents: bigint; at: Date }[],
): Promise<Map<string, number[]>> {
  if (labels.length === 0) return new Map();
  const times = labels.map((label) => label.at.getTime());
  const rows = await getDb()
    .select({ amountCents: transactions.amountCents, at: transactions.occurredAt })
    .from(transactions)
    .where(
      and(
        userScoped(ctx).owns(transactions),
        inArray(transactions.type, ["income", "expense"]),
        gte(transactions.occurredAt, new Date(Math.min(...times) - SAME_PAYMENT_DAYS * DAY_MS)),
        lte(transactions.occurredAt, new Date(Math.max(...times) + SAME_PAYMENT_DAYS * DAY_MS)),
      ),
    );
  const byAmount = new Map<string, number[]>();
  for (const row of rows) {
    const list = byAmount.get(String(row.amountCents)) ?? [];
    list.push(row.at.getTime());
    byAmount.set(String(row.amountCents), list);
  }
  return byAmount;
}

/** Whether a movement of the same amount is near the row's day; the one found is used up. */
function takeSamePayment(taken: Map<string, number[]>, label: { amountCents: bigint; at: Date }): boolean {
  const list = taken.get(String(label.amountCents));
  const found = list?.findIndex((time) => Math.abs(time - label.at.getTime()) <= SAME_PAYMENT_DAYS * DAY_MS);
  if (list === undefined || found === undefined || found === -1) return false;
  list.splice(found, 1);
  return true;
}
