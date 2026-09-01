/**
 * Deterministic extraction pass: runs the anchors from `anchors.ts` over the
 * normalized payslip text. It knows nothing about specific labels — swap the
 * config and the engine follows.
 *
 * Contract: never throws. A field that cannot be resolved comes back `null`
 * with provenance explaining why, so the confidence pass can demote it instead
 * of the pipeline failing (PLAN §4 "Failure handling").
 */

import { parseItalianNumber } from "@/lib/format";
import type { PayslipField } from "@/lib/contracts";
import { PAYSLIP_FIELDS } from "@/lib/contracts";
import {
  AUX_ANCHORS,
  AUX_FIELDS,
  COMPOSITE_FIELDS,
  FIELD_ANCHORS,
  GRID_HEADER_SYNONYMS,
  GRIDS,
  ITALIAN_MONTHS,
  PERIOD_LABELS,
  type Anchor,
  type AuxField,
  type GridId,
  type ValueStrategy,
} from "@/lib/payroll/anchors";
import { splitLines } from "@/lib/payroll/text";

export interface FieldProvenance {
  /** Which label synonym matched, or the grid id for grid strategies. */
  readonly anchor: string | null;
  readonly strategy: ValueStrategy["kind"] | null;
  readonly lineIndex: number | null;
  readonly line: string | null;
  /** Set when the engine deliberately refused to guess. */
  readonly degraded?: boolean;
  readonly note?: string;
}

export interface RulesResult {
  readonly fields: Partial<Record<PayslipField, number | null>>;
  readonly aux: Partial<Record<AuxField, number | null>>;
  readonly provenance: Partial<Record<PayslipField, FieldProvenance>>;
  /** Fields the engine refused to guess (e.g. flattened grid). */
  readonly degraded: readonly PayslipField[];
  /** Non-fatal problems worth surfacing; the pass still returns a result. */
  readonly errors: readonly string[];
}

/** A number as printed on an Italian payslip, optionally sign-suffixed. */
const NUMBER_TOKEN = /^[+-]?(?:\d{1,3}(?:\.\d{3})+|\d+)(?:,\d{1,4})?-?$/;

interface NumberHit {
  readonly value: number;
  readonly offset: number;
}

/**
 * Whole-token scan (rather than a global regex) so dates like `31/08/2026`,
 * percentages and codes glued to text never register as amounts.
 */
export function numbersOnLine(line: string): NumberHit[] {
  const hits: NumberHit[] = [];
  let offset = 0;
  for (const token of line.split(" ")) {
    const start = offset;
    offset += token.length + 1;
    if (!token) continue;
    const stripped = token.replace(/^[(€]+/, "").replace(/[)€]+$/, "");
    if (!NUMBER_TOKEN.test(stripped)) continue;
    // Payroll printings put the minus sign after the figure.
    const negative = stripped.endsWith("-");
    const parsed = parseItalianNumber(negative ? stripped.slice(0, -1) : stripped);
    if (parsed === null) continue;
    hits.push({ value: negative ? -parsed : parsed, offset: start });
  }
  return hits;
}

function pick(hits: readonly NumberHit[], occurrence: number | "last"): number | null {
  if (hits.length === 0) return null;
  if (occurrence === "last") return hits[hits.length - 1]?.value ?? null;
  return hits[occurrence - 1]?.value ?? null;
}

interface LabelHit {
  readonly lineIndex: number;
  readonly label: string;
  readonly endOffset: number;
}

function findLabel(upperLines: readonly string[], labels: readonly string[]): LabelHit | null {
  for (let i = 0; i < upperLines.length; i += 1) {
    const line = upperLines[i];
    if (line === undefined) continue;
    for (const label of labels) {
      const at = line.indexOf(label);
      if (at >= 0) return { lineIndex: i, label, endOffset: at + label.length };
    }
  }
  return null;
}

interface GridReading {
  readonly headerLineIndex: number | null;
  readonly headerCount: number;
  readonly values: readonly number[];
  readonly valueLineIndex: number | null;
}

/**
 * Reads a header/value grid. The value row must carry exactly as many numbers
 * as the grid has headers; anything else is reported as-is and the caller
 * refuses to associate columns (the flattened-OCR defect, PLAN §4).
 */
export function readGrid(lines: readonly string[], gridId: GridId): GridReading {
  const spec = GRIDS[gridId];
  const upper = lines.map((l) => l.toUpperCase());
  for (let i = 0; i < upper.length; i += 1) {
    const line = upper[i];
    if (line === undefined) continue;
    let hits = 0;
    for (const header of spec.headers) {
      const synonyms = GRID_HEADER_SYNONYMS[header] ?? [];
      if (line.includes(header) || synonyms.some((s) => line.includes(s))) hits += 1;
    }
    if (hits < spec.minHeaderHits) continue;

    for (let j = i + 1; j < Math.min(upper.length, i + 4); j += 1) {
      const candidate = lines[j];
      if (candidate === undefined) continue;
      const values = numbersOnLine(candidate).map((h) => h.value);
      if (values.length === 0) continue;
      return {
        headerLineIndex: i,
        headerCount: spec.headers.length,
        values,
        valueLineIndex: j,
      };
    }
    return { headerLineIndex: i, headerCount: spec.headers.length, values: [], valueLineIndex: null };
  }
  return { headerLineIndex: null, headerCount: spec.headers.length, values: [], valueLineIndex: null };
}

interface Resolution {
  readonly value: number | null;
  readonly provenance: FieldProvenance;
}

function resolveAnchor(
  anchor: Anchor,
  lines: readonly string[],
  upperLines: readonly string[],
  gridCache: Map<GridId, GridReading>,
): Resolution | null {
  if (anchor.strategy.kind === "grid-column") {
    const gridId = anchor.strategy.grid;
    let reading = gridCache.get(gridId);
    if (!reading) {
      reading = readGrid(lines, gridId);
      gridCache.set(gridId, reading);
    }
    if (reading.headerLineIndex === null) return null;
    const base: FieldProvenance = {
      anchor: `grid:${gridId}`,
      strategy: "grid-column",
      lineIndex: reading.valueLineIndex ?? reading.headerLineIndex,
      line: lines[reading.valueLineIndex ?? reading.headerLineIndex] ?? null,
    };
    if (reading.values.length !== reading.headerCount) {
      return {
        value: null,
        provenance: {
          ...base,
          degraded: true,
          note: `grid flattened: ${reading.values.length} values under ${reading.headerCount} headers — column not guessed`,
        },
      };
    }
    const value = reading.values[anchor.strategy.column];
    return { value: value ?? null, provenance: base };
  }

  const hit = findLabel(upperLines, anchor.labels);
  if (!hit) return null;
  const line = lines[hit.lineIndex];
  if (line === undefined) return null;
  const base: FieldProvenance = {
    anchor: hit.label,
    strategy: anchor.strategy.kind,
    lineIndex: hit.lineIndex,
    line,
    ...(anchor.note ? { note: anchor.note } : {}),
  };

  if (anchor.strategy.kind === "same-line") {
    const after = numbersOnLine(line).filter((h) => h.offset >= hit.endOffset);
    const value = pick(after, anchor.strategy.occurrence);
    return value === null ? null : { value, provenance: base };
  }

  if (anchor.strategy.kind === "nth-number-on-line") {
    const value = pick(numbersOnLine(line), anchor.strategy.index);
    return value === null ? null : { value, provenance: base };
  }

  // next-line
  for (let j = hit.lineIndex + 1; j < Math.min(lines.length, hit.lineIndex + 3); j += 1) {
    const next = lines[j];
    if (next === undefined) continue;
    const hits = numbersOnLine(next);
    if (hits.length === 0) continue;
    const value = pick(hits, anchor.strategy.occurrence);
    if (value === null) return null;
    return { value, provenance: { ...base, lineIndex: j, line: next } };
  }
  return null;
}

function resolveField(
  anchors: readonly Anchor[],
  lines: readonly string[],
  upperLines: readonly string[],
  gridCache: Map<GridId, GridReading>,
): Resolution | null {
  let degradedFallback: Resolution | null = null;
  for (const anchor of anchors) {
    const resolved = resolveAnchor(anchor, lines, upperLines, gridCache);
    if (!resolved) continue;
    if (resolved.value !== null) return resolved;
    // Keep the explanation in case no later anchor produces a value either.
    if (resolved.provenance.degraded && !degradedFallback) degradedFallback = resolved;
  }
  return degradedFallback;
}

/** `PERIODO DI PAGA AGOSTO 2026` / `08/2026` → `2026-08-01`. */
export function detectPeriodMonth(text: string): string | null {
  const lines = splitLines(text).map((l) => l.toUpperCase());
  const candidates = lines.filter((l) => PERIOD_LABELS.some((p) => l.includes(p)));
  const haystack = candidates.length > 0 ? candidates : lines;
  for (const line of haystack) {
    for (const [name, month] of Object.entries(ITALIAN_MONTHS)) {
      const at = line.indexOf(name);
      if (at < 0) continue;
      const year = /\b(20\d{2})\b/.exec(line.slice(at));
      if (!year?.[1]) continue;
      return `${year[1]}-${String(month).padStart(2, "0")}-01`;
    }
    const numeric = /\b(0[1-9]|1[0-2])[/-](20\d{2})\b/.exec(line);
    if (numeric?.[1] && numeric[2]) return `${numeric[2]}-${numeric[1]}-01`;
  }
  return null;
}

/**
 * Runs every anchor over the text. Each field is resolved independently so one
 * bad anchor cannot take the pass down.
 */
export function runRules(text: string): RulesResult {
  const lines = splitLines(text);
  const upperLines = lines.map((l) => l.toUpperCase());
  const gridCache = new Map<GridId, GridReading>();

  const fields: Partial<Record<PayslipField, number | null>> = {};
  const aux: Partial<Record<AuxField, number | null>> = {};
  const provenance: Partial<Record<PayslipField, FieldProvenance>> = {};
  const degraded: PayslipField[] = [];
  const errors: string[] = [];

  for (const auxField of AUX_FIELDS) {
    try {
      const resolved = resolveField(AUX_ANCHORS[auxField], lines, upperLines, gridCache);
      aux[auxField] = resolved?.value ?? null;
    } catch (err) {
      aux[auxField] = null;
      errors.push(`aux ${auxField}: ${errorMessage(err)}`);
    }
  }

  for (const field of PAYSLIP_FIELDS) {
    try {
      const resolved = resolveField(FIELD_ANCHORS[field], lines, upperLines, gridCache);
      fields[field] = resolved?.value ?? null;
      if (resolved) provenance[field] = resolved.provenance;
      if (resolved?.provenance.degraded && resolved.value === null) degraded.push(field);
    } catch (err) {
      fields[field] = null;
      errors.push(`field ${field}: ${errorMessage(err)}`);
    }
  }

  // Composites win when every part resolved: the payslip prints IRPEF and the
  // two addizionali separately, never a single "total tax withheld" figure.
  for (const [field, parts] of Object.entries(COMPOSITE_FIELDS) as ReadonlyArray<
    [PayslipField, readonly AuxField[]]
  >) {
    const values = parts.map((p) => aux[p] ?? null);
    if (values.some((v) => v === null)) continue;
    const total = values.reduce<number>((sum, v) => sum + (v ?? 0), 0);
    fields[field] = round2(total);
    provenance[field] = {
      anchor: parts.join(" + "),
      strategy: "same-line",
      lineIndex: null,
      line: null,
      note: "composite of the printed tax lines",
    };
  }

  return { fields, aux, provenance, degraded, errors };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
