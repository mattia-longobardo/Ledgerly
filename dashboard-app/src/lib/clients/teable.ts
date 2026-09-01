import { z } from "zod";
import { UpstreamError, type AccountKey } from "@/lib/contracts";
import { env } from "@/lib/env";
import { parseItalianNumber } from "@/lib/format";
import { monthKey, monthKeyOf } from "@/lib/time";
import { HttpError, errorMessage, httpRequest, requestJson } from "./http";

export const TEABLE_DATE_FIELD = "Date";

/**
 * The `TOTAL` column is a per-row formula. It is still pivoted so the shape of
 * the table stays faithfully represented, but NOTHING reads it as a balance any
 * more: it is `ING+Buddy Bank+Mediolanum+IsyBank+EToro+Binance+Fideuram+Revolut`
 * — verified against the live field definition on 2026-09-01 — so it omits
 * Fondo Cometa outright, and on the rows this app appends (Date + ING + Revolut
 * only) it omits every hand-tracked account too. Net worth is summed from the
 * account columns instead; see `src/lib/calc/networth.ts`.
 */
export const TEABLE_TOTAL_FIELD = "TOTAL";

/**
 * Hand-tracked columns the app reads but never writes. `Extract` rather than a
 * bare union so a typo cannot invent an account key that nothing else knows.
 */
export type TeableExtraKey = Extract<
  AccountKey,
  "etoro" | "buddy_bank" | "isybank" | "mediolanum" | "binance"
>;

export type TeableSeriesKey = AccountKey | TeableExtraKey;

/** Column name → series key. Order matters only for stable output. */
export const TEABLE_NUMBER_COLUMNS: ReadonlyArray<readonly [string, TeableSeriesKey]> = [
  ["ING", "ing"],
  ["EToro", "etoro"],
  ["Buddy Bank", "buddy_bank"],
  ["IsyBank", "isybank"],
  ["Mediolanum", "mediolanum"],
  ["Fondo Cometa", "cometa"],
  ["Binance", "binance"],
  ["Fideuram", "fideuram"],
  ["Revolut", "revolut_total"],
  [TEABLE_TOTAL_FIELD, "total"],
];

/**
 * Columns an UPDATE is allowed to touch — the two balances this app owns.
 *
 * `Date` is deliberately absent: on an existing row the date is the owner's,
 * and rewriting it would move a hand-placed row to a different day (or, worse,
 * a different month once the Europe/Rome offset is applied). Every other column
 * — `EToro`, `Buddy Bank`, `IsyBank`, `Mediolanum`, `Binance`, `Fondo Cometa`,
 * `Fideuram` — is typed in by hand, and `TOTAL` is a formula: sending any of
 * them would be data loss, not an update.
 */
export const TEABLE_UPDATE_COLUMNS = ["ING", "Revolut"] as const;

/**
 * Columns the snapshot job is allowed to write. Everything else stays
 * untouched. A CREATE additionally stamps `Date`, because a brand-new row has
 * to say which month it belongs to.
 */
export const TEABLE_WRITE_COLUMNS = [TEABLE_DATE_FIELD, ...TEABLE_UPDATE_COLUMNS] as const;

const recordSchema = z.object({
  id: z.string(),
  fields: z.record(z.string(), z.unknown()),
  createdTime: z.string().optional(),
});

const recordListSchema = z.object({
  records: z.array(recordSchema),
});

const fieldSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.string(),
  isComputed: z.boolean().optional(),
});

const fieldListSchema = z.array(fieldSchema);

export type TeableRecord = z.infer<typeof recordSchema>;
export type TeableField = z.infer<typeof fieldSchema>;

export interface TeablePoint {
  key: TeableSeriesKey;
  column: string;
  month: string;
  value: number | null;
}

function tableUrl(path = ""): string {
  const base = env().TEABLE_URL.replace(/\/+$/, "");
  return `${base}/api/table/${env().TEABLE_TABLE_ID}${path}`;
}

function headers(): Record<string, string> {
  return {
    authorization: `Bearer ${env().TEABLE_TOKEN}`,
    "content-type": "application/json",
  };
}

const MAX_TAKE = 1000;
const MAX_PAGES = 200;

export interface ListOptions {
  take?: number;
  /**
   * Raw Teable `orderBy` value, passed through verbatim. There is no default:
   * see the sort note on `listAllocationRecords`. If you set this, note that
   * Teable wants field **ids**, not names.
   */
  orderBy?: string;
  signal?: AbortSignal;
}

/** Instant a row's `Date` cell refers to, or null when it has none. */
export function recordDate(record: TeableRecord): number | null {
  const raw = record.fields[TEABLE_DATE_FIELD];
  if (typeof raw !== "string" || raw === "") return null;
  const t = Date.parse(raw);
  return Number.isNaN(t) ? null : t;
}

/**
 * Ascending by the `Date` cell. Rows without a usable date sort last, keeping
 * their relative order — they are dropped by `pivotToSeries` anyway, and a
 * silent reshuffle would be worse than a predictable tail.
 *
 * Sorting happens here rather than upstream because Teable's `orderBy` takes
 * field **ids** and silently ignores anything else. This client used to send
 * `[{"fieldId":"Date","order":"asc"}]` — a field NAME — and got creation order
 * back with no error: confirmed against the live table on 2026-09-01, where the
 * 2026-09-01 row is returned BEFORE the 2026-08-31 one. Anything downstream
 * that says "the latest row" must therefore never trust array order as it
 * arrives, and now does not have to.
 */
export function sortAllocationRecords(records: readonly TeableRecord[]): TeableRecord[] {
  return [...records].sort((a, b) => {
    const da = recordDate(a);
    const db = recordDate(b);
    if (da === null && db === null) return 0;
    if (da === null) return 1;
    if (db === null) return -1;
    return da - db;
  });
}

/**
 * Teable answers with at most `take` rows and gives no reliable total, so page
 * until a short page comes back rather than trusting any count. Paging runs in
 * the server's own (creation) order, which is stable; the result is then sorted
 * by `Date` here — see `sortAllocationRecords`.
 */
export async function listAllocationRecords(opts: ListOptions = {}): Promise<TeableRecord[]> {
  const take = Math.min(opts.take ?? MAX_TAKE, MAX_TAKE);
  const out: TeableRecord[] = [];

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const qs = new URLSearchParams({
      take: String(take),
      skip: String(page * take),
      fieldKeyType: "name",
      ...(opts.orderBy ? { orderBy: opts.orderBy } : {}),
    });
    const body = await requestJson("teable", `${tableUrl("/record")}?${qs}`, recordListSchema, {
      headers: headers(),
      signal: opts.signal,
    });
    out.push(...body.records);
    if (body.records.length < take) return sortAllocationRecords(out);
  }
  throw new UpstreamError(
    "teable",
    `record paging exceeded ${MAX_PAGES} pages — refusing to loop`,
    { take },
    false,
  );
}

let fieldMapCache: Map<string, TeableField> | null = null;

/** Cached: the field list only changes when the owner edits the table by hand. */
export async function getFieldMap(opts: { signal?: AbortSignal } = {}): Promise<Map<string, TeableField>> {
  if (fieldMapCache) return fieldMapCache;
  const fields = await requestJson("teable", tableUrl("/field"), fieldListSchema, {
    headers: headers(),
    signal: opts.signal,
  });
  fieldMapCache = new Map(fields.map((f) => [f.name, f]));
  return fieldMapCache;
}

export function clearFieldMapCache(): void {
  fieldMapCache = null;
}

/**
 * Delete an Allocation column by NAME — the destructive half of removing a
 * hand-tracked account. `DELETE /api/table/{tableId}/field/{fieldId}` (summary
 * "Delete field"), verified against the live instance's OpenAPI document on
 * 2026-09-01: the single-field path exposes exactly one method, `delete`, and
 * it takes the field **id**, not its name — so the id is resolved through the
 * cached `getFieldMap()` first, the same map the write guards validate against.
 *
 * A missing column is a no-op SUCCESS, not an error: "delete the account and its
 * column if it exists" means an account whose column was already removed by hand
 * still deletes cleanly. Both routes to "already gone" are covered — the field
 * absent from the map, and a stale map that still lists it (the DELETE then 404s
 * upstream). Any other upstream failure is raised as `UpstreamError`.
 *
 * The field-map cache is dropped afterwards so the next read reflects the table
 * as it now is.
 */
export async function deleteAllocationField(
  columnName: string,
  opts: { signal?: AbortSignal } = {},
): Promise<{ deleted: boolean }> {
  const fields = await getFieldMap(opts);
  const field = fields.get(columnName);
  if (!field) return { deleted: false };

  try {
    await httpRequest("teable", tableUrl(`/field/${encodeURIComponent(field.id)}`), {
      method: "DELETE",
      headers: headers(),
      signal: opts.signal,
    });
  } catch (err) {
    if (err instanceof HttpError && err.status === 404) {
      clearFieldMapCache();
      return { deleted: false };
    }
    throw new UpstreamError(
      "teable",
      `failed to delete field "${columnName}": ${errorMessage(err)}`,
      err,
      false,
    );
  }

  clearFieldMapCache();
  return { deleted: true };
}

export interface AllocationRowInput {
  /** Date-only `YYYY-MM-DD`, Europe/Rome civil date. */
  date: string;
  ing: number;
  revolut: number;
}

export type AllocationWriteAction = "created" | "updated";

export interface AllocationWriteResult {
  /** The row that now holds the month's figures — new or pre-existing. */
  recordId: string;
  action: AllocationWriteAction;
  /**
   * Ids of the OTHER rows that also fell in the target month, oldest first.
   * Present only when the table already contained more than one: the caller
   * puts them in the run detail so the ambiguity shows up in the log instead of
   * being swallowed. Nothing here is ever written to or deleted.
   */
  duplicates?: string[];
}

/**
 * The Europe/Rome civil month a row belongs to, or null when its `Date` cell is
 * empty or unparseable.
 *
 * Rome, not UTC, because Teable stores instants and the owner's rows are placed
 * by Rome wall-clock: the live table has a row at `2026-05-31T23:02Z`, which is
 * `2026-06-01 01:02` in Rome and is JUNE's row. A UTC `slice(0, 7)` would file
 * it under May and then happily append a second June row on top of it. The
 * conversion is delegated to `monthKey`, the same helper the rest of the app
 * derives month buckets with, so there is exactly one place where the offset
 * and its DST switch are handled.
 */
export function recordMonthKey(record: TeableRecord): string | null {
  const at = recordDate(record);
  return at === null ? null : monthKey(new Date(at));
}

/**
 * Every row falling in `date`'s Rome month, ascending by `Date`.
 *
 * Ascending because the caller treats the LAST element as the winner: the
 * newest row is the one the owner has been looking at most recently, and it is
 * also the one `pivotToSeries`' last-wins reducer already reads as the month's
 * value — so patching it keeps the write and the read agreeing. Ties (two rows
 * on the same instant) fall back to Teable's own order, which is creation
 * order, so the most recently created wins; either way the choice is fixed, not
 * random.
 */
export function findMonthRecords(
  records: readonly TeableRecord[],
  date: string,
): TeableRecord[] {
  const target = monthKeyOf(date);
  return sortAllocationRecords(records).filter((r) => recordMonthKey(r) === target);
}

function assertWritable(row: AllocationRowInput): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(row.date)) {
    throw new UpstreamError("teable", `date must be YYYY-MM-DD, got "${row.date}"`, row, false);
  }
  if (!Number.isFinite(row.ing) || !Number.isFinite(row.revolut)) {
    throw new UpstreamError("teable", "refusing to write a non-finite balance", row, false);
  }
}

/**
 * Guard kept on BOTH write paths: a renamed column has to fail loudly, before
 * anything is sent, rather than half-write a row Teable silently accepts.
 */
async function assertFieldsExist(opts: { signal?: AbortSignal }): Promise<void> {
  const fields = await getFieldMap(opts);
  const missing = TEABLE_WRITE_COLUMNS.filter((name) => !fields.has(name));
  if (missing.length > 0) {
    throw new UpstreamError(
      "teable",
      `allocation table is missing expected field(s): ${missing.join(", ")}`,
      { known: [...fields.keys()] },
      false,
    );
  }
}

/** POST /record — the create shape takes a `records` ARRAY. */
async function createAllocationRow(
  row: AllocationRowInput,
  opts: { signal?: AbortSignal },
): Promise<string> {
  const body = JSON.stringify({
    fieldKeyType: "name",
    records: [
      {
        fields: {
          [TEABLE_DATE_FIELD]: row.date,
          ING: row.ing,
          Revolut: row.revolut,
        },
      },
    ],
  });

  const created = await requestJson("teable", tableUrl("/record"), recordListSchema, {
    method: "POST",
    headers: headers(),
    body,
    signal: opts.signal,
  });
  const first = created.records[0];
  if (!first) {
    throw new UpstreamError("teable", "create returned no record", created, false);
  }
  return first.id;
}

/**
 * PATCH /record/{recordId} — note the shape differs from the create: a SINGLE
 * `record` object, and the answer is one record, not a `{records: […]}` list.
 * Verified against the live instance's OpenAPI document on 2026-09-01
 * (`Update record`: body `{fieldKeyType, typecast?, record:{fields}, order?}`,
 * 200 → `{id, fields, …}`).
 *
 * Only `TEABLE_UPDATE_COLUMNS` are sent, so the hand-tracked columns, the
 * computed `TOTAL` and the row's own `Date` are left exactly as they are.
 */
async function updateAllocationRow(
  recordId: string,
  row: AllocationRowInput,
  opts: { signal?: AbortSignal },
): Promise<string> {
  const body = JSON.stringify({
    fieldKeyType: "name",
    record: { fields: { ING: row.ing, Revolut: row.revolut } },
  });

  const updated = await requestJson(
    "teable",
    tableUrl(`/record/${encodeURIComponent(recordId)}`),
    recordSchema,
    { method: "PATCH", headers: headers(), body, signal: opts.signal },
  );
  return updated.id;
}

/**
 * Writes one month's ING + Revolut into the allocation table: PATCH when that
 * month already has a row, POST only when it has none.
 *
 * It is an upsert rather than an append because the table is one-row-per-month
 * (PLAN §3.1, verified against the live table) and Teable enforces no
 * uniqueness of its own — the job used to append unconditionally and produced
 * two rows for 2026-09 (`rec41rYnDKuR6WV9786` and `recE2yriad1cOxQxQQK`, since
 * merged by hand into the latter), which
 * is exactly what a `curl --retry`, the sweep's catch-up and a manual "run now"
 * can each cause. Matching on the month rather than on the id stored in
 * `monthly_snapshots` makes it converge even onto a row this app never created
 * — the owner adds rows by hand too.
 */
export async function upsertAllocationRow(
  row: AllocationRowInput,
  opts: { signal?: AbortSignal } = {},
): Promise<AllocationWriteResult> {
  assertWritable(row);
  await assertFieldsExist(opts);

  const matches = findMonthRecords(await listAllocationRecords({ signal: opts.signal }), row.date);
  const winner = matches[matches.length - 1];

  if (!winner) {
    return { recordId: await createAllocationRow(row, opts), action: "created" };
  }

  const duplicates = matches.slice(0, -1).map((r) => r.id);
  const recordId = await updateAllocationRow(winner.id, row, opts);
  return { recordId, action: "updated", ...(duplicates.length > 0 ? { duplicates } : {}) };
}

function toNumber(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === "") return null;
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (typeof raw === "string") return parseItalianNumber(raw);
  return null;
}

function toMonth(raw: unknown): string | null {
  if (typeof raw !== "string" || raw === "") return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return `${raw.slice(0, 7)}-01`;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return monthKey(parsed);
}

/**
 * Rows → `(key, month, value)`. An empty cell is a gap, never a zero: the
 * owner backfills columns by hand and 0 would be a lie in every average.
 *
 * Two rows can land in the same month: on 2026-09-01 the live table held both
 * a 2026-08-31T22:00Z row and a 2026-09-01T20:56Z one, both 2026-09 in
 * Europe/Rome (the owner has since merged them by hand, and
 * `upsertAllocationRow` now stops the job re-creating the situation — but
 * hand-added rows can still collide, so this stays correct for two). The sort below
 * is by `(month, key)` only and `Array.prototype.sort` is stable, so points
 * sharing a month and a key keep the order their records came in. Feed this
 * `sortAllocationRecords` output and "later in the array" means "later in the
 * month", which is what a last-wins reducer needs.
 */
export function pivotToSeries(records: readonly TeableRecord[]): TeablePoint[] {
  const points: TeablePoint[] = [];
  for (const record of records) {
    const month = toMonth(record.fields[TEABLE_DATE_FIELD]);
    if (!month) continue;
    for (const [column, key] of TEABLE_NUMBER_COLUMNS) {
      if (!(column in record.fields)) continue;
      points.push({ key, column, month, value: toNumber(record.fields[column]) });
    }
  }
  points.sort((a, b) => (a.month === b.month ? a.key.localeCompare(b.key) : a.month.localeCompare(b.month)));
  return points;
}
