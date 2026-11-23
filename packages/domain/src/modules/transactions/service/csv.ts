// modules/transactions/service/csv.ts — the import of a CSV file of movements on an account «a mano»
// (decision ST-8): the preview, the import and the map saved per account. Each row becomes a manual
// movement on the path of the dialog (`createManualTransactions`): the same row, the same checks.
//
// Whether the account is «a mano» and the balance after the import are the accounts module's: the
// application that joins the two runs them, as for one manual movement (rule M8).
import { and, eq } from "drizzle-orm";
import { CSV_MAX_BYTES, CSV_MAX_ROWS, CSV_PREVIEW_ROWS, csvMapSchema } from "@ledgerly/api-contract";
import type { Ctx } from "../../../platform/context";
import { getDb } from "../../../platform/db/client";
import { userScoped } from "../../../platform/db/scope";
import { today } from "../../../shared/dates";
import { centsToDecimal } from "../../../shared/money";
import {
  type CsvMap,
  type CsvMovement,
  csvRows,
  dataRecords,
  decodeText,
  detectDelimiter,
  parseRecords,
  proposeMap,
} from "../rules/csv";
import { createManualTransactions } from "../manual";
import { csvColumnMaps } from "../schema";
import { requireMovementAccount } from "./guards";
import { listCategories } from "../taxonomy";

type CsvCtx = Pick<Ctx, "userId" | "timeZone">;

/** A file the import does not read: too large, too many rows, empty, or not text. */
export class CsvError extends Error {
  constructor(readonly code: "too_large" | "too_many_rows" | "empty") {
    super(code);
    this.name = "CsvError";
  }
}

/** The records of a file, after the limits of size and of rows. */
function recordsOf(bytes: Uint8Array, delimiter?: string) {
  if (bytes.byteLength > CSV_MAX_BYTES) throw new CsvError("too_large");
  const text = decodeText(bytes);
  const chosen = delimiter ?? detectDelimiter(text);
  const records = parseRecords(text, chosen);
  if (records.every((record) => record.every((field) => field.trim() === ""))) throw new CsvError("empty");
  return { delimiter: chosen, records };
}

function requireRowCount(count: number): void {
  if (count > CSV_MAX_ROWS) throw new CsvError("too_many_rows");
}

/** The map saved for the account, or `null`. */
export async function csvMapOf(ctx: Pick<Ctx, "userId">, accountId: string): Promise<CsvMap | null> {
  const [row] = await getDb()
    .select()
    .from(csvColumnMaps)
    .where(and(userScoped(ctx).owns(csvColumnMaps), eq(csvColumnMaps.accountId, accountId)));
  if (!row) return null;
  const { map, delimiter, decimalSeparator, dateFormat, skipRows, header } = row;
  const saved = csvMapSchema.safeParse({
    columns: map,
    delimiter,
    decimalSeparator,
    dateFormat,
    skipRows,
    header,
  });
  return saved.success ? saved.data : null;
}

/** Saves the map of the account in place of the one it had. */
export async function saveCsvMap(
  ctx: Pick<Ctx, "userId">,
  accountId: string,
  input: unknown,
): Promise<CsvMap> {
  const map = csvMapSchema.parse(input);
  await requireMovementAccount(ctx, accountId);
  const { columns, ...settings } = map;
  await getDb()
    .insert(csvColumnMaps)
    .values(userScoped(ctx).stamp({ accountId, map: columns, ...settings }))
    .onConflictDoUpdate({
      target: csvColumnMaps.accountId,
      set: { map: columns, ...settings, updatedAt: new Date() },
      setWhere: eq(csvColumnMaps.userId, ctx.userId),
    });
  return map;
}

/** One row of the preview: its values when it is a movement, its code when it is refused. */
function previewRow(row: ReturnType<typeof csvRows>[number]) {
  if ("reason" in row) {
    return {
      row: row.row,
      outcome: "refused" as const,
      reason: row.reason,
      on: null,
      amount: null,
      payee: null,
    };
  }
  const { movement } = row;
  const signed = movement.kind === "expense" ? -movement.amountCents : movement.amountCents;
  return {
    row: row.row,
    outcome: "ok" as const,
    reason: null,
    on: movement.on,
    amount: centsToDecimal(signed),
    payee: movement.payee,
  };
}

/**
 * What a file would import, writing nothing: the delimiter, the columns, the saved map and the one
 * the file proposes, and the first rows read with the saved map or else the proposed one.
 */
export async function previewCsv(ctx: CsvCtx, accountId: string, bytes: Uint8Array) {
  await requireMovementAccount(ctx, accountId);
  const savedMap = await csvMapOf(ctx, accountId);
  const { delimiter, records } = recordsOf(bytes, savedMap?.delimiter);
  const proposedMap = proposeMap(records, delimiter);
  const used = savedMap ?? proposedMap ?? { skipRows: 0, header: false };
  const data = dataRecords(records, used);
  requireRowCount(data.length);
  const header = used.header ? (records[used.skipRows] ?? []) : (data[0]?.cells ?? []).map(() => "");
  const scope = { accountId, today: today(ctx.timeZone) };
  const rows = "columns" in used ? csvRows(records, used, scope).slice(0, CSV_PREVIEW_ROWS) : [];
  return {
    delimiter,
    columns: header.map((name) => name.trim()),
    rowCount: data.length,
    savedMap,
    proposedMap,
    rows: rows.map(previewRow),
  };
}

/** The person's categories by type and name, for the names a file writes. */
async function categoryIdsByName(ctx: Pick<Ctx, "userId">): Promise<Map<string, string>> {
  const categories = await listCategories(ctx);
  return new Map(
    categories.map((category) => [`${category.type}\n${category.name.toLowerCase()}`, category.id]),
  );
}

const categoryIdOf = (names: ReadonlyMap<string, string>, movement: CsvMovement) =>
  movement.category === null
    ? null
    : (names.get(`${movement.kind}\n${movement.category.toLowerCase()}`) ?? null);

/**
 * Writes the rows of a file as manual movements of the account. A row already imported — its key
 * is written — is a duplicate and writes nothing. A category the file names is the person's
 * category of that name and type; an unknown one leaves the movement to the automatic categories.
 */
export async function importCsv(ctx: CsvCtx, accountId: string, bytes: Uint8Array, input: unknown) {
  const map = csvMapSchema.parse(input);
  await requireMovementAccount(ctx, accountId);
  const { records } = recordsOf(bytes, map.delimiter);
  const rows = csvRows(records, map, { accountId, today: today(ctx.timeZone) });
  requireRowCount(rows.length);
  const movements = rows.flatMap((row) => ("movement" in row ? [row.movement] : []));
  const names = map.columns.category === null ? new Map<string, string>() : await categoryIdsByName(ctx);
  const { created } = await createManualTransactions(
    ctx,
    movements.map((movement) => ({
      key: movement.key,
      input: {
        kind: movement.kind,
        amountCents: movement.amountCents,
        on: movement.on,
        accountId,
        categoryId: categoryIdOf(names, movement),
        payee: movement.payee,
        note: movement.note,
      },
    })),
  );
  return {
    created,
    duplicates: movements.length - created,
    refused: rows.flatMap((row) => ("reason" in row ? [{ row: row.row, reason: row.reason }] : [])),
  };
}
