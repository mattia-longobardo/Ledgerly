import { boxOf, labelKey, parseItalianNumber } from "@/modules/imports/pdf/layout";
import type { PageText, TextItem } from "@/modules/imports/pdf/text";
import type { EvidenceInput } from "@/modules/imports/service";
import { type CivilDate, isCivilDate } from "@/platform/dates";

/**
 * Cometa's position summary ("riepilogo posizione", GC §8.5), read with coordinates (plan F6
 * §3.4.5): a label on the left and its amount on the same baseline to the right; the value as a
 * figure of its own under "Valore posizione al: <date>". Every value keeps its page and box, so
 * the review highlights where it came from. The "Aderente" and "Azienda" of this document include
 * the enrolment fees (GC §8.5).
 */

export const POSITION_PARSER_VERSION = "cometa-position@1";

export const POSITION_FIELDS = [
  "valuationDate",
  "value",
  "tfr",
  "worker",
  "employer",
  "transfersIn",
  "inflows",
  "advances",
  "redemptions",
  "rita",
  "outflows",
  "reportedGain",
] as const;
export type PositionField = (typeof POSITION_FIELDS)[number];
export type PositionAmountField = Exclude<PositionField, "valuationDate">;

/** The printed labels, compared without spaces, dots, stars or case. */
const LABELS: Record<string, PositionAmountField> = {
  TFR: "tfr",
  ADERENTE: "worker",
  AZIENDA: "employer",
  TRASFERIMENTO: "transfersIn",
  TRASFERIMENTI: "transfersIn",
  TOTALEENTRATE: "inflows",
  ANTICIPI: "advances",
  ANTICIPAZIONI: "advances",
  RISCATTI: "redemptions",
  RATERITA: "rita",
  RITA: "rita",
  TOTALEUSCITE: "outflows",
  RENDIMENTO: "reportedGain",
};

/** Two baselines this close are one row. */
const ROW_TOLERANCE = 1.5;

export interface ParsedPosition {
  fields: EvidenceInput[];
}

const amountText = (text: string) => text.replace(/€|EUR/gi, "").trim();

function isAmount(item: TextItem): boolean {
  const text = amountText(item.text);
  return text !== "" && parseItalianNumber(text) !== null && /,\d{2}$/.test(text);
}

function keyOf(text: string): string {
  return labelKey(text).replace(/[*:]/g, "");
}

/** "31/08/2026" → "2026-08-31". */
function civil(text: string): CivilDate | null {
  const match = /(\d{2})\/(\d{2})\/(\d{4})/.exec(text);
  const date = match ? `${match[3]}-${match[2]}-${match[1]}` : null;
  return date && isCivilDate(date) ? date : null;
}

function evidence(
  field: PositionField,
  value: string | null,
  items: readonly TextItem[],
  page: PageText,
  sourceLabel: string | null,
): EvidenceInput {
  return {
    field,
    value,
    unit: field === "valuationDate" ? "date" : "eur",
    sourceLabel,
    page: items.length > 0 ? page.page : null,
    bbox: items.length > 0 ? boxOf(items, page) : null,
    origin: "printed",
    confidence: value === null ? 0 : 0.99,
    rawText: items.length > 0 ? items.map((item) => item.text).join(" ") : null,
  };
}

/** Every field of the summary, `null` (and unconfident) when the page does not show it. */
export function parseCometaPosition(pages: readonly PageText[]): ParsedPosition {
  const found = new Map<PositionField, EvidenceInput>();
  for (const page of pages) {
    const amounts = page.items.filter(isAmount);
    const labelled = new Set<TextItem>();
    for (const item of page.items) {
      if (isAmount(item)) continue;
      const dated = /valore\s+posizione\s+al/i.test(item.text) ? civil(item.text) : null;
      if (dated && !found.has("valuationDate")) {
        found.set("valuationDate", evidence("valuationDate", dated, [item], page, "Valore posizione al"));
        continue;
      }
      const field = LABELS[keyOf(item.text)];
      if (!field || found.has(field)) continue;
      const amount = amounts
        .filter((one) => Math.abs(one.baseline - item.baseline) <= ROW_TOLERANCE && one.x0 > item.x1)
        .sort((a, b) => a.x0 - b.x0)[0];
      if (!amount) continue;
      labelled.add(amount);
      found.set(
        field,
        evidence(field, parseItalianNumber(amountText(amount.text)), [item, amount], page, item.text.trim()),
      );
    }
    // The value: the largest amount on the page that no label claims.
    const value = amounts.filter((one) => !labelled.has(one)).sort((a, b) => b.size - a.size)[0];
    if (value && !found.has("value")) {
      found.set(
        "value",
        evidence("value", parseItalianNumber(amountText(value.text)), [value], page, "Valore posizione"),
      );
    }
  }
  const empty = pages[0] ?? { page: 1, width: 1, height: 1, items: [] };
  return {
    fields: POSITION_FIELDS.map((field) => found.get(field) ?? evidence(field, null, [], empty, null)),
  };
}
