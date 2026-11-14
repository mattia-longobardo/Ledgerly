// scripts/snapshot-format.ts — what a numbers snapshot keeps of a view, how it is written and how
// two of them are compared (`scripts/numbers-snapshot.ts`). Pure: no database, no clock.
import { createHash } from "node:crypto";

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

const CIVIL = /^\d{4}-\d{2}(?:-\d{2})?$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Where a row's own name may sit one level down (`AccountRow.account.name`, `HomeFundRow.fund.name`). */
const NAMED_PARTS = ["account", "fund", "rule", "pocket", "subscription", "service", "summary"];
const LABEL_FIELDS = ["month", "year", "on", "key", "bucket", "kind", "period", "id"];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value) && !(value instanceof Date);

/** Every `{ id, name }` in the views: how an identifier is spelled in the file. */
export function namesIn(value: unknown, names = new Map<string, string>()): Map<string, string> {
  if (value instanceof Map) for (const entry of value.values()) namesIn(entry, names);
  else if (Array.isArray(value)) for (const entry of value) namesIn(entry, names);
  else if (isRecord(value)) {
    if (typeof value.id === "string" && typeof value.name === "string") names.set(value.id, value.name);
    for (const entry of Object.values(value)) namesIn(entry, names);
  }
  return names;
}

function labelOf(row: Record<string, unknown>, names: ReadonlyMap<string, string>): string | null {
  if (typeof row.name === "string") return row.name;
  for (const part of NAMED_PARTS) {
    const inner = row[part];
    if (isRecord(inner) && typeof inner.name === "string") return inner.name;
  }
  for (const field of LABEL_FIELDS) {
    const value = row[field];
    if (typeof value === "number") return String(value);
    if (typeof value === "string") return names.get(value) ?? (UUID.test(value) ? null : value);
  }
  return null;
}

/**
 * What the snapshot keeps of a value. `undefined` means "not a number of the product": dropped
 * from an object, `null` in a list (the positions of a series must not shift).
 */
export function project(value: unknown, names: ReadonlyMap<string, string>): Json | undefined {
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "number") return Number.isFinite(value) ? value : String(value);
  if (typeof value === "string") return CIVIL.test(value) ? value : undefined;
  if (value instanceof Date || value === undefined || typeof value === "function") return undefined;
  if (value instanceof Map) return project(Object.fromEntries(value), names);
  if (Array.isArray(value)) {
    // Rows become an object keyed by what the row is called, so the file does not depend on the
    // order of a list; when two rows share a label the list stays a list.
    const labels = value.map((row) => (isRecord(row) ? labelOf(row, names) : null));
    if (
      value.length > 0 &&
      labels.every((label) => label !== null) &&
      new Set(labels).size === value.length
    ) {
      return Object.fromEntries(
        value.map((row, index) => [labels[index] as string, project(row, names) ?? null]),
      );
    }
    return value.map((entry) => project(entry, names) ?? null);
  }
  if (isRecord(value)) {
    const kept: [string, Json][] = [];
    let unnamed = 0;
    for (const [key, entry] of Object.entries(value)) {
      const projected = project(entry, names);
      if (projected === undefined) continue;
      // A record keyed by identifier (`freeByAccount`): the name, or the position when it has none.
      kept.push([UUID.test(key) ? (names.get(key) ?? `#${(unnamed += 1)}`) : key, projected]);
    }
    return kept.length > 0 ? Object.fromEntries(kept) : undefined;
  }
  return undefined;
}

/** The same value with every object's keys in order: what makes the file's bytes stable. */
function sorted(value: Json): Json {
  if (Array.isArray(value)) return value.map(sorted);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sorted(value[key])]),
  );
}

export function canonical(value: Json): string {
  return `${JSON.stringify(sorted(value), null, 1)}\n`;
}

export function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/** The names of the numbers that differ between two snapshots, as paths; never their values. */
export function differences(before: Json, after: Json, path = ""): string[] {
  if (JSON.stringify(before) === JSON.stringify(after)) return [];
  const bothObjects =
    before !== null && after !== null && typeof before === "object" && typeof after === "object";
  if (!bothObjects || Array.isArray(before) !== Array.isArray(after)) return [path || "(root)"];
  const a = before as Record<string, Json>;
  const b = after as Record<string, Json>;
  return [...new Set([...Object.keys(a), ...Object.keys(b)])].sort().flatMap((key) => {
    const at = path ? `${path}.${key}` : key;
    if (!(key in a) || !(key in b)) return [at];
    return differences(a[key], b[key], at);
  });
}
