import { inflateRawSync } from "node:zlib";
import { headerKey, OperationsParseError, type RawTable } from "./cometa-operations";

/**
 * Just enough of XLSX to read an operations export saved from a spreadsheet (plan F6 §3.6.1): the
 * ZIP's central directory, the shared strings and the first worksheet, values only — no formulas
 * evaluated, no styles. Numbers come back written the Italian way, as the HTML export prints them,
 * so one parser reads both; a date column's serial numbers become `dd/mm/yyyy`.
 */

const MAX_ENTRY_BYTES = 20 * 1024 * 1024;

function zipEntries(bytes: Uint8Array): Map<string, Uint8Array> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let at = bytes.length - 22; at >= Math.max(0, bytes.length - 65_557); at -= 1) {
    if (view.getUint32(at, true) === 0x06054b50) {
      end = at;
      break;
    }
  }
  if (end < 0) throw new OperationsParseError("no_table", "zip");
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  const entries = new Map<string, Uint8Array>();
  for (let index = 0; index < count; index += 1) {
    if (view.getUint32(at, true) !== 0x02014b50) throw new OperationsParseError("no_table", "zip");
    const method = view.getUint16(at + 10, true);
    const compressed = view.getUint32(at + 20, true);
    const size = view.getUint32(at + 24, true);
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    const local = view.getUint32(at + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(at + 46, at + 46 + nameLength));
    at += 46 + nameLength + extraLength + commentLength;
    if (!/^xl\/(sharedStrings\.xml|worksheets\/sheet\d+\.xml)$/.test(name)) continue;
    if (size > MAX_ENTRY_BYTES) throw new OperationsParseError("no_table", "too_large");
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    const data = bytes.subarray(start, start + compressed);
    if (method === 0) entries.set(name, data);
    else if (method === 8)
      entries.set(name, new Uint8Array(inflateRawSync(data, { maxOutputLength: MAX_ENTRY_BYTES })));
    else throw new OperationsParseError("no_table", "zip_method");
  }
  return entries;
}

function unescapeXml(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&amp;/g, "&");
}

function textOf(xml: string): string {
  return unescapeXml([...xml.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((match) => match[1]).join(""));
}

function columnIndex(ref: string): number {
  const letters = /^[A-Z]+/.exec(ref)?.[0] ?? "A";
  return [...letters].reduce((sum, letter) => sum * 26 + letter.charCodeAt(0) - 64, 0) - 1;
}

/** Excel's day number (1900 system) as `dd/mm/yyyy`. */
function serialDate(serial: number): string {
  const date = new Date(Date.UTC(1899, 11, 30) + Math.round(serial) * 86_400_000);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(date.getUTCDate())}/${pad(date.getUTCMonth() + 1)}/${date.getUTCFullYear()}`;
}

export function tableFromXlsx(bytes: Uint8Array): RawTable {
  const entries = zipEntries(bytes);
  const decoder = new TextDecoder();
  const shared = entries.has("xl/sharedStrings.xml")
    ? [...decoder.decode(entries.get("xl/sharedStrings.xml")).matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map(
        (match) => textOf(match[1]),
      )
    : [];
  const sheetName = [...entries.keys()]
    .filter((name) => name.startsWith("xl/worksheets/"))
    .sort((a, b) => Number(/(\d+)\.xml$/.exec(a)?.[1]) - Number(/(\d+)\.xml$/.exec(b)?.[1]))[0];
  if (!sheetName) throw new OperationsParseError("no_table");
  const sheet = decoder.decode(entries.get(sheetName));

  const raw: { cells: string[]; numeric: boolean[] }[] = [];
  for (const row of sheet.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells: string[] = [];
    const numeric: boolean[] = [];
    for (const cell of row[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attributes = cell[1];
      const body = cell[2] ?? "";
      const index = columnIndex(
        /\br="([A-Z]+)\d+"/.exec(attributes)?.[1] ?? String.fromCharCode(65 + cells.length),
      );
      const type = /\bt="([^"]+)"/.exec(attributes)?.[1] ?? "n";
      const value = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
      let text = "";
      if (type === "s" && value !== undefined) text = shared[Number(value)] ?? "";
      else if (type === "inlineStr") text = textOf(body);
      else if (value !== undefined) text = unescapeXml(value);
      while (cells.length < index) {
        cells.push("");
        numeric.push(false);
      }
      cells[index] = text.trim();
      numeric[index] = type === "n" && value !== undefined;
    }
    if (cells.some((one) => one !== "")) raw.push({ cells, numeric });
  }
  // A sheet with rows but no operations header is somebody else's spreadsheet, not a broken export.
  const headerRow = raw.findIndex((row) => row.cells.map(headerKey).includes("tipooperazione"));
  if (headerRow < 0) throw new OperationsParseError(raw.length > 0 ? "not_an_export" : "no_table");
  const header = raw[headerRow].cells;
  const dates = header.map((name) => headerKey(name).startsWith("data"));
  const rows = raw.slice(headerRow + 1).map(({ cells, numeric }) => ({
    group: null,
    cells: cells.map((text, index) => {
      if (!numeric[index] || text === "") return text;
      if (dates[index]) return serialDate(Number(text));
      return text.replace(".", ",");
    }),
  }));
  return { header, rows };
}
