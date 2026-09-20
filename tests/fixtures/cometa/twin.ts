// tests/fixtures/cometa/twin.ts — synthetic twins of the Cometa documents (spec §11, D14).
//
// The operations export (the HTML table the portal serves under an `.xls` name, and the same table
// as a minimal XLSX) and the position summary PDF, drawn where the real one draws them. Every
// number is invented and adds up the way the real documents do; nothing here is anyone's data.
// Imports nothing from `src/`, so Vitest and Playwright's Node side can both build them.
import { deflateRawSync } from "node:zlib";
import { PDFDocument, StandardFonts } from "pdf-lib";

export interface TwinMovement {
  compartment: string;
  /** As printed, Italian ("30,000"). */
  units: string;
  unitPrice: string;
  unitPriceDate: string;
}

export interface TwinOperation {
  type: string;
  state: string;
  /** `dd/mm/yyyy`. */
  date: string;
  /** "2031 PRIMO", or "" when the export leaves it blank. */
  competence: string;
  employerTaxCode: string;
  employerName: string;
  worker: string;
  employer: string;
  tfr: string;
  other: string;
  fees: string;
  net: string;
  movements: TwinMovement[];
}

export const OPERATION_COLUMNS = [
  "Tipo Operazione",
  "Stato Operazione",
  "Data Operazione",
  "Trimestre Comp.",
  "Cod. Fisc. Azienda",
  "Denominazione Azienda",
  "Importo Lordo Aderente",
  "Importo Lordo Azienda",
  "Tfr",
  "Altro",
  "Quota Spese",
  "Importo Netto Spese*",
  "Comparto",
  "Numero Quote",
  "Valore Quota",
  "Data Valore Quota",
];

function rowsOf(operation: TwinOperation): string[][] {
  const head = [
    operation.type,
    operation.state,
    operation.date,
    operation.competence,
    operation.employerTaxCode,
    operation.employerName,
    operation.worker,
    operation.employer,
    operation.tfr,
    operation.other,
    operation.fees,
    operation.net,
  ];
  const movements = operation.movements.length > 0 ? operation.movements : [null];
  return movements.map((movement) =>
    movement === null
      ? [...head, "", "", "", ""]
      : [...head, movement.compartment, movement.units, movement.unitPrice, movement.unitPriceDate],
  );
}

const escapeHtml = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/ /g, "&nbsp;");

/** The export as the portal serves it: one `<tbody>` per operation, one `<tr>` per unit movement. */
export function twinOperationsHtml(operations: readonly TwinOperation[]): Uint8Array {
  const header = OPERATION_COLUMNS.map((name) => `<th class="ng-binding">${name}</th>`).join("");
  const bodies = operations
    .map((operation) => {
      const rows = rowsOf(operation)
        .map(
          (cells) =>
            `<tr>${cells.map((cell) => `<td class="ng-binding">${escapeHtml(cell)}</td>`).join("")}</tr>`,
        )
        .join("\n");
      return `<tbody ng-repeat="operazione in operazioni">\n${rows}\n</tbody>`;
    })
    .join("\n");
  const html = `<html><head><meta charset="utf-8"></head><body>
<table class="width-100"><thead><tr>${header}</tr></thead>
<!-- ngRepeat: operazione in operazioni -->
${bodies}
</table></body></html>`;
  return new TextEncoder().encode(html);
}

// ——— A minimal XLSX of the same table (stored, uncompressed where it helps) ———

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function zip(files: readonly { name: string; bytes: Uint8Array }[]): Uint8Array {
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const file of files) {
    const name = new TextEncoder().encode(file.name);
    const deflated = deflateRawSync(file.bytes);
    const crc = crc32(file.bytes);
    const local = new Uint8Array(30 + name.length);
    const view = new DataView(local.buffer);
    view.setUint32(0, 0x04034b50, true);
    view.setUint16(4, 20, true);
    view.setUint16(8, 8, true);
    view.setUint32(14, crc, true);
    view.setUint32(18, deflated.length, true);
    view.setUint32(22, file.bytes.length, true);
    view.setUint16(26, name.length, true);
    local.set(name, 30);
    chunks.push(local, deflated);

    const entry = new Uint8Array(46 + name.length);
    const entryView = new DataView(entry.buffer);
    entryView.setUint32(0, 0x02014b50, true);
    entryView.setUint16(4, 20, true);
    entryView.setUint16(6, 20, true);
    entryView.setUint16(10, 8, true);
    entryView.setUint32(16, crc, true);
    entryView.setUint32(20, deflated.length, true);
    entryView.setUint32(24, file.bytes.length, true);
    entryView.setUint16(28, name.length, true);
    entryView.setUint32(42, offset, true);
    entry.set(name, 46);
    central.push(entry);
    offset += local.length + deflated.length;
  }
  const directory = central.reduce((sum, entry) => sum + entry.length, 0);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, files.length, true);
  endView.setUint16(10, files.length, true);
  endView.setUint32(12, directory, true);
  endView.setUint32(16, offset, true);
  const all = [...chunks, ...central, end];
  const size = all.reduce((sum, chunk) => sum + chunk.length, 0);
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const chunk of all) {
    bytes.set(chunk, at);
    at += chunk.length;
  }
  return bytes;
}

const xmlEscape = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** The same table as an XLSX with inline strings: the other format the importer accepts. */
export function twinOperationsXlsx(operations: readonly TwinOperation[]): Uint8Array {
  const rows = [OPERATION_COLUMNS, ...operations.flatMap(rowsOf)];
  const sheet = rows
    .map((cells, rowIndex) => {
      const columns = cells
        .map((cell, columnIndex) => {
          const reference = `${String.fromCharCode(65 + columnIndex)}${rowIndex + 1}`;
          return `<c r="${reference}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(cell)}</t></is></c>`;
        })
        .join("");
      return `<row r="${rowIndex + 1}">${columns}</row>`;
    })
    .join("");
  const encode = (text: string) => new TextEncoder().encode(text);
  return zip([
    {
      name: "[Content_Types].xml",
      bytes: encode(
        `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`,
      ),
    },
    {
      name: "_rels/.rels",
      bytes: encode(
        `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
      ),
    },
    {
      name: "xl/workbook.xml",
      bytes: encode(
        `<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheets><sheet name="Operazioni" sheetId="1" r:id="rId1" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"/></sheets></workbook>`,
      ),
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      bytes: encode(
        `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`,
      ),
    },
    {
      name: "xl/worksheets/sheet1.xml",
      bytes: encode(
        `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheet}</sheetData></worksheet>`,
      ),
    },
  ]);
}

// ——— The position summary ———

export interface TwinPosition {
  name: string;
  /** `dd/mm/yyyy`. */
  valuationDate: string;
  /** Italian amounts without the euro sign ("2.251,05"). */
  value: string;
  tfr: string;
  worker: string;
  employer: string;
  transfers: string;
  inflows: string;
  advances: string;
  redemptions: string;
  rita: string;
  outflows: string;
  gain: string;
}

/** The one-page summary: a label on the left, its amount on the right of the same baseline. */
export async function twinPositionPdf(position: TwinPosition): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595.28, 841.89]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const draw = (text: string, x: number, y: number, size = 10) => page.drawText(text, { x, y, size, font });
  const right = (text: string, y: number) => {
    const value = `${text} EUR`;
    draw(value, 520 - font.widthOfTextAtSize(value, 10), y);
  };
  draw(position.name, 236.7, 665.1);
  draw("LA TUA POSIZIONE PREVIDENZIALE", 182.9, 643, 13);
  draw(`Valore posizione al: ${position.valuationDate}`, 217.4, 622.1);
  draw("RIEPILOGO POSIZIONE INDIVIDUALE *", 185.5, 574.3, 12);
  draw(`EUR ${position.value}`, 256.7, 552.6, 14);
  const rows: [string, string][] = [
    ["TFR", position.tfr],
    ["Aderente", position.worker],
    ["Azienda", position.employer],
    ["Trasferimento**", position.transfers],
    ["Totale Entrate", position.inflows],
    ["Anticipi", position.advances],
    ["Riscatti", position.redemptions],
    ["Rate R.I.T.A.", position.rita],
    ["Totale Uscite", position.outflows],
    ["Rendimento", position.gain],
  ];
  let y = 534.1;
  for (const [label, amount] of rows) {
    draw(label, 89, y);
    right(amount, y);
    y -= 23;
  }
  draw("* Importo lordo: alla richiesta di erogazione si applica la tassazione vigente.", 89, 295.6, 8);
  return pdf.save();
}
