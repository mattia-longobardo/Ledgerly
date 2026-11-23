// Transactions · the import of a CSV file of movements on an account «a mano» (rewrite plan R5c,
// decision ST-8; 12-account-modes.md §12.2). The map of the columns is saved per account. One
// source: the domain imports the limits and `csvMapSchema` (`@ledgerly/domain/transactions`).
import { z } from "zod";
import { defineRoute } from "../route";
import { civilDate, money } from "../primitives";
import { byAccount } from "../accounts/shared";
import { ACCOUNT_ID } from "./shared";

/** The largest file the import reads, and the most rows of movements in it. */
export const CSV_MAX_BYTES = 5 * 1024 * 1024;
export const CSV_MAX_ROWS = 20_000;
/** How many rows the preview parses. */
export const CSV_PREVIEW_ROWS = 20;
/** The most columns a map names: a column is its place in the row, from 0. */
const CSV_MAX_COLUMNS = 200;
const CSV_MAX_SKIP = 100;

const column = z
  .number()
  .int()
  .min(0)
  .max(CSV_MAX_COLUMNS - 1);
const DATE_TOKENS = /^(DD|MM|YYYY)([./-])(DD|MM|YYYY)\2(DD|MM|YYYY)$/;

/**
 * How the rows of a file become movements: the place of each column, from 0, and how the file
 * writes its values. The amount is one signed column, or a debit and a credit column (either may
 * be missing). An open vocabulary (rule M13): the date format is checked by its form, `DD`, `MM`
 * and `YYYY` once each with one separator.
 */
export const csvMapSchema = z
  .object({
    columns: z
      .object({
        date: column,
        amount: column.nullable(),
        debit: column.nullable(),
        credit: column.nullable(),
        payee: column.nullable(),
        note: column.nullable(),
        category: column.nullable(),
      })
      .strict()
      .refine(({ amount, debit, credit }) => (amount !== null) !== (debit !== null || credit !== null), {
        message: "Either one amount column or a debit and/or a credit column.",
      }),
    delimiter: z.string().regex(/^[^"\r\n\w\s.]$|^\t$/),
    decimalSeparator: z.enum([",", "."]),
    dateFormat: z
      .string()
      .regex(DATE_TOKENS)
      .refine((format) => new Set(format.split(/[./-]/)).size === 3),
    skipRows: z.number().int().min(0).max(CSV_MAX_SKIP),
    header: z.boolean(),
  })
  .strict();

/** A refusal of a row: an open code (`bad_date`, `bad_amount`, `no_amount`, `zero_amount`, …). */
const reasonCode = z.string().regex(/^[a-z_]+$/);

const MAP_EXAMPLE = {
  columns: { date: 0, amount: 2, debit: null, credit: null, payee: 1, note: null, category: null },
  delimiter: ";",
  decimalSeparator: ",",
  dateFormat: "DD/MM/YYYY",
  skipRows: 0,
  header: true,
};

const CSV_EXAMPLE = "Data;Descrizione;Importo\r\n14/10/2026;Corner shop;-42,80\r\n";
const fileExample = () => new File([CSV_EXAMPLE], "movements.csv", { type: "text/csv" });

/** A JSON text in a field of a form, parsed and then checked against `schema`. */
const jsonField = <T extends z.ZodType>(schema: T, description: string) =>
  z
    .string()
    .describe(description)
    .transform((text, context) => {
      try {
        const value: unknown = JSON.parse(text);
        return value;
      } catch {
        context.addIssue({ code: "custom", message: "Not JSON." });
        return z.NEVER;
      }
    })
    .pipe(schema);

const CSV_ERRORS = ["invalid", "not_found", "conflict", "too_large"] as const;
const REFUSALS =
  "`conflict` with `reason` `account_not_manual` for an account with a source, `account_unavailable` " +
  "for an archived one; `too_large` past 5 MiB or 20,000 rows (`reason` `too_many_rows`); `invalid` " +
  "with `reason` `empty` or `unreadable`.";

export const previewCsv = defineRoute({
  id: "preview_csv",
  method: "POST",
  path: "/accounts/{id}/csv/preview",
  scope: "read",
  capability: "transactions",
  summary:
    "Reads a CSV file of movements (`multipart/form-data`, `file`) for an account «a mano» and writes " +
    "nothing: the delimiter found, the columns, the map saved for the account and a proposed one, and " +
    `the first ${CSV_PREVIEW_ROWS} rows parsed with the saved map, or the proposed one, each with its ` +
    `outcome. ${REFUSALS}`,
  actions: [],
  params: byAccount,
  bodyFormat: "multipart",
  body: z.object({ file: z.file() }),
  response: z.object({
    delimiter: z.string(),
    /** The names of the header, or empty names when the file has none. */
    columns: z.array(z.string()),
    rowCount: z.number().int(),
    savedMap: csvMapSchema.nullable(),
    proposedMap: csvMapSchema.nullable(),
    rows: z.array(
      z.object({
        /** The row of the file, from 1, as a spreadsheet numbers it. */
        row: z.number().int(),
        outcome: z.enum(["ok", "refused"]),
        reason: reasonCode.nullable(),
        on: civilDate().nullable(),
        amount: money().nullable(),
        payee: z.string().nullable(),
      }),
    ),
  }),
  errors: CSV_ERRORS,
  example: {
    params: { id: ACCOUNT_ID },
    body: { file: fileExample() },
    response: {
      delimiter: ";",
      columns: ["Data", "Descrizione", "Importo"],
      rowCount: 1,
      savedMap: null,
      proposedMap: MAP_EXAMPLE,
      rows: [
        { row: 2, outcome: "ok", reason: null, on: "2026-10-14", amount: "-42.80", payee: "Corner shop" },
      ],
    },
  },
});

export const importCsv = defineRoute({
  id: "import_csv",
  method: "POST",
  path: "/accounts/{id}/csv/import",
  scope: "write",
  capability: "transactions",
  summary:
    "Writes the rows of a CSV file (`multipart/form-data`: `file`, `map` as JSON, `saveMap` `true` to " +
    "keep the map for the account) as manual movements of an account «a mano»: each changes the " +
    "balance as a movement written by hand. A row already imported is a duplicate and is not written " +
    `again, so the same file sent twice writes once. ${REFUSALS}`,
  actions: [],
  params: byAccount,
  bodyFormat: "multipart",
  body: z.object({
    file: z.file(),
    map: jsonField(csvMapSchema, "The map as JSON, the body of `PUT /accounts/{id}/csv-map`."),
    saveMap: z.enum(["true", "false"]).optional(),
  }),
  response: z.object({
    created: z.number().int(),
    duplicates: z.number().int(),
    refused: z.array(z.object({ row: z.number().int(), reason: reasonCode })),
  }),
  errors: CSV_ERRORS,
  example: {
    params: { id: ACCOUNT_ID },
    body: { file: fileExample(), map: JSON.stringify(MAP_EXAMPLE), saveMap: "true" },
    response: { created: 1, duplicates: 0, refused: [] },
  },
});

export const getCsvMap = defineRoute({
  id: "get_csv_map",
  method: "GET",
  path: "/accounts/{id}/csv-map",
  scope: "read",
  capability: "transactions",
  summary: `The map of the columns saved for an account «a mano»; null when none is. ${REFUSALS}`,
  actions: [],
  params: byAccount,
  response: z.object({ map: csvMapSchema.nullable() }),
  errors: CSV_ERRORS,
  example: { params: { id: ACCOUNT_ID }, response: { map: MAP_EXAMPLE } },
});

export const saveCsvMap = defineRoute({
  id: "save_csv_map",
  method: "PUT",
  path: "/accounts/{id}/csv-map",
  scope: "write",
  capability: "transactions",
  summary: `Saves the map of the columns for an account «a mano», in place of the one it had. ${REFUSALS}`,
  actions: [],
  params: byAccount,
  body: csvMapSchema,
  response: z.object({ map: csvMapSchema }),
  errors: CSV_ERRORS,
  example: { params: { id: ACCOUNT_ID }, body: MAP_EXAMPLE, response: { map: MAP_EXAMPLE } },
});
