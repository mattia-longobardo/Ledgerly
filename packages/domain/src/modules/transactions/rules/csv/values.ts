// The values of a CSV cell: an amount in cents, never through a float, and a day. Pure.
import { type CivilDate, isCivilDate } from "../../../../shared/dates";
import { type Cents, parseCents } from "../../../../shared/money";

type DecimalSeparator = "," | ".";

/** Spaces of every kind, a thousands apostrophe and the common currency signs: none is the number. */
const NOISE = /[\s  '€$£]/g;

/** The sign of a written amount: `-12,50`, `12,50-` and `(12,50)` are all money out. */
function signOf(text: string): { negative: boolean; body: string } {
  if (text.startsWith("(") && text.endsWith(")")) return { negative: true, body: text.slice(1, -1) };
  if (text.endsWith("-")) return { negative: true, body: text.slice(0, -1) };
  if (text.startsWith("-")) return { negative: true, body: text.slice(1) };
  if (text.startsWith("+")) return { negative: false, body: text.slice(1) };
  return { negative: false, body: text };
}

/** `1.234,56` with the decimal comma as the plain `1234.56`; `null` when the groups are wrong. */
function plainDecimal(body: string, decimal: DecimalSeparator): string | null {
  const thousands = decimal === "," ? "\\." : ",";
  const point = decimal === "," ? "," : "\\.";
  const grouped = new RegExp(`^\\d{1,3}(${thousands}\\d{3})+(${point}\\d+)?$`);
  const plain = new RegExp(`^\\d+(${point}\\d+)?$`);
  if (!grouped.test(body) && !plain.test(body)) return null;
  const whole = body.replaceAll(decimal === "," ? "." : ",", "");
  return decimal === "," ? whole.replace(",", ".") : whole;
}

/** The amount a cell writes, in cents; `null` when it is not an amount. An empty cell is `null`. */
export function parseAmountCell(raw: string, decimal: DecimalSeparator): Cents | null {
  const { negative, body } = signOf(raw.replace(NOISE, ""));
  const plain = plainDecimal(body, decimal);
  if (plain === null) return null;
  const cents = parseCents(plain);
  return negative ? -cents : cents;
}

/** The decimal separator most of the samples end with (`12,50` or `12.50`); the comma on a tie. */
export function detectDecimal(samples: readonly string[]): DecimalSeparator {
  let commas = 0;
  let points = 0;
  for (const sample of samples) {
    const text = sample.replace(NOISE, "").replace(/[)-]$/, "");
    if (/,\d{1,2}$/.test(text)) commas += 1;
    else if (/\.\d{1,2}$/.test(text)) points += 1;
  }
  return points > commas ? "." : ",";
}

const DATE_SEPARATORS = /[./-]/;

/** The day a cell writes in `format` (`DD/MM/YYYY`, …); a time after the day is left out. */
export function parseDateCell(raw: string, format: string): CivilDate | null {
  const separator = DATE_SEPARATORS.exec(format)?.[0];
  if (separator === undefined) return null;
  const order = format.split(separator);
  const parts = (raw.trim().split(/[\sT]/)[0] ?? "").split(separator);
  if (parts.length !== 3) return null;
  const part = (token: string) => parts[order.indexOf(token)] ?? "";
  const [year, month, day] = [part("YYYY"), part("MM"), part("DD")];
  if (!/^\d{4}$/.test(year) || !/^\d{1,2}$/.test(month) || !/^\d{1,2}$/.test(day)) return null;
  const date = `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  return isCivilDate(date) ? date : null;
}

/** The formats the proposal tries, day before month first: the files of a European bank. */
const DATE_FORMATS = ["DD/MM/YYYY", "YYYY-MM-DD", "DD.MM.YYYY", "DD-MM-YYYY", "MM/DD/YYYY", "YYYY/MM/DD"];

/** The format most samples read in, the earlier on a tie; `null` when none reads any sample. */
export function detectDateFormat(samples: readonly string[]): string | null {
  const filled = samples.filter((sample) => sample.trim() !== "");
  let best: { format: string | null; count: number } = { format: null, count: 0 };
  for (const format of DATE_FORMATS) {
    const count = filled.filter((sample) => parseDateCell(sample, format) !== null).length;
    if (count > best.count) best = { format, count };
  }
  return best.format;
}
