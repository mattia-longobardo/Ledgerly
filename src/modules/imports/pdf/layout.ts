import type { TextItem } from "./text";

/**
 * Rebuilding a form from positioned text (spec §7.8 step 3; owner's spec L25–26). The order text
 * comes out of a PDF is not reliable — labels and values can be drawn in separate runs — so nothing
 * here looks at it: rows come from baselines, columns from where labels start.
 */

/** A word of text with its box: an item split at its spaces. */
export type Token = TextItem;

/** Items at most this size are a form's printed labels; larger ones are the values filled in. */
export const LABEL_MAX_SIZE = 7;

/** How far apart two baselines may be and still be one row. */
const ROW_TOLERANCE = 1.5;

/**
 * Splits an item at its spaces. A value run can carry several columns ("1,00 2.345,67000"); the
 * forms these are for print values in a fixed-pitch font, so each character is the run's width
 * over its length — exact there, an approximation for a proportional font.
 */
export function tokensOf(item: TextItem): Token[] {
  const pitch = (item.x1 - item.x0) / Math.max(item.text.length, 1);
  const tokens: Token[] = [];
  for (const match of item.text.matchAll(/\S+/g)) {
    const start = match.index ?? 0;
    tokens.push({
      ...item,
      text: match[0],
      x0: item.x0 + start * pitch,
      x1: item.x0 + (start + match[0].length) * pitch,
    });
  }
  return tokens;
}

/**
 * A label compared by what it says: capitals, no spaces and no dots. Some generators draw letters
 * apart ("MES E RETRIBUITO"), and the dots in abbreviations come and go ("ROL. GOD.").
 */
export function labelKey(text: string): string {
  return text.toUpperCase().replace(/[\s.]/g, "");
}

export interface Label {
  key: string;
  text: string;
  page: number;
  x0: number;
  x1: number;
  baseline: number;
}

export interface LabelRow {
  page: number;
  baseline: number;
  /** Left to right. */
  labels: Label[];
}

/**
 * The label rows of a page. A label's second line (the "AZIENDA" under "COD.", the "ATTUALE" under
 * "ARROTONDAMENTO") joins the label it hangs under instead of starting a column of its own.
 */
export function labelRows(items: readonly TextItem[]): LabelRow[] {
  const labels = items
    .filter((item) => item.size <= LABEL_MAX_SIZE)
    .toSorted((a, b) => a.page - b.page || a.baseline - b.baseline || a.x0 - b.x0);
  const rows: LabelRow[] = [];
  for (const item of labels) {
    const parent = rows
      .filter((row) => row.page === item.page)
      .flatMap((row) => row.labels.map((label) => ({ row, label })))
      .find(
        ({ label }) =>
          item.baseline - label.baseline > 3 &&
          item.baseline - label.baseline < 9 &&
          item.x0 >= label.x0 - 1 &&
          item.x0 <= label.x1,
      );
    if (parent) {
      parent.label.text = `${parent.label.text} ${item.text}`;
      parent.label.key = labelKey(parent.label.text);
      parent.label.x1 = Math.max(parent.label.x1, item.x1);
      continue;
    }
    const label: Label = {
      key: labelKey(item.text),
      text: item.text,
      page: item.page,
      x0: item.x0,
      x1: item.x1,
      baseline: item.baseline,
    };
    const row = rows.find(
      (one) => one.page === item.page && Math.abs(one.baseline - item.baseline) <= ROW_TOLERANCE,
    );
    if (row) row.labels.push(label);
    else rows.push({ page: item.page, baseline: item.baseline, labels: [label] });
  }
  for (const row of rows) row.labels.sort((a, b) => a.x0 - b.x0);
  return rows;
}

export interface ValueRow {
  page: number;
  baseline: number;
  /** Left to right. */
  tokens: Token[];
}

/** The value rows of a page: its larger text, split into words, grouped by baseline. */
export function valueRows(items: readonly TextItem[]): ValueRow[] {
  const tokens = items
    .filter((item) => item.size > LABEL_MAX_SIZE)
    .flatMap(tokensOf)
    .toSorted((a, b) => a.page - b.page || a.baseline - b.baseline || a.x0 - b.x0);
  const rows: ValueRow[] = [];
  for (const token of tokens) {
    const row = rows.find(
      (one) => one.page === token.page && Math.abs(one.baseline - token.baseline) <= ROW_TOLERANCE,
    );
    if (row) row.tokens.push(token);
    else rows.push({ page: token.page, baseline: token.baseline, tokens: [token] });
  }
  for (const row of rows) row.tokens.sort((a, b) => a.x0 - b.x0);
  return rows;
}

/**
 * The label a value belongs to: of the labels starting before the value ends, the last one.
 * Amounts are right-aligned in their box and text is left-aligned, and both end before the next
 * label starts — so the right edge decides, for both. `null` for a value left of every label.
 */
export function labelFor(labels: readonly Label[], token: Token): Label | null {
  let found: Label | null = null;
  for (const label of labels) {
    if (label.x0 <= token.x1 - 0.5) found = label;
  }
  return found;
}

/** The label row a value row fills: the one just above it, a value line's height away. */
export function labelRowAbove(rows: readonly LabelRow[], values: ValueRow): LabelRow | null {
  const candidates = rows.filter(
    (row) =>
      row.page === values.page &&
      values.baseline - row.baseline >= 12 &&
      values.baseline - row.baseline <= 19,
  );
  return candidates.toSorted((a, b) => b.baseline - a.baseline)[0] ?? null;
}

/** A value found under a label, with every token it is made of. */
export interface Cell {
  label: Label;
  tokens: Token[];
}

/** Every cell of a value row, by the label above it. */
export function cellsOf(rows: readonly LabelRow[], values: ValueRow): Cell[] {
  const header = labelRowAbove(rows, values);
  if (!header) return [];
  const cells = new Map<Label, Token[]>();
  for (const token of values.tokens) {
    const label = labelFor(header.labels, token);
    if (!label) continue;
    cells.set(label, [...(cells.get(label) ?? []), token]);
  }
  return [...cells].map(([label, tokens]) => ({ label, tokens }));
}

/** The text of tokens, in reading order. */
export function textOf(tokens: readonly Token[]): string {
  return tokens.map((token) => token.text).join(" ");
}

/** The box around tokens as fractions of the page, origin top left: `[x0, y0, x1, y1]`. */
export function boxOf(
  tokens: readonly Token[],
  page: { width: number; height: number },
): [number, number, number, number] {
  const round = (value: number) => Math.round(Math.min(Math.max(value, 0), 1) * 1e5) / 1e5;
  return [
    round(Math.min(...tokens.map((token) => token.x0)) / page.width),
    round(Math.min(...tokens.map((token) => token.top)) / page.height),
    round(Math.max(...tokens.map((token) => token.x1)) / page.width),
    round(Math.max(...tokens.map((token) => token.bottom)) / page.height),
  ];
}

/**
 * Italian numbers as printed (spec §7.8 step 5): `2.345,67` → `2345.67`, `-20,40` → `-20.40`, and a
 * trailing minus (`20,40-`) too. The decimal part is kept whole (`11,56069` → `11.56069`); anything
 * else is `null`, never a guess.
 */
export function parseItalianNumber(text: string): string | null {
  const match = /^([+-]?)(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d+))?([+-]?)$/.exec(text.trim());
  if (!match) return null;
  const [, lead, whole, fraction, trail] = match;
  if (lead !== "" && trail !== "") return null;
  const sign = lead === "-" || trail === "-" ? "-" : "";
  const integer = whole.replaceAll(".", "").replace(/^0+(?=\d)/, "");
  const value = fraction === undefined ? integer : `${integer}.${fraction}`;
  return /^0(\.0+)?$/.test(value) ? value : `${sign}${value}`;
}
