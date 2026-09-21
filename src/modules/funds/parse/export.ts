import { sniffFormat } from "@/modules/imports/rules";
import { OperationsParseError, operationsOf, type ParsedExport, tableFromHtml } from "./cometa-operations";
import { tableFromXlsx } from "./xlsx";

/**
 * An operations export from its bytes, whatever it was saved as (GC §11.1): the HTML table Cometa
 * serves under `.xls`, or an XLSX. A binary `.xls` (OLE2) is refused with a code that asks for
 * XLSX or HTML instead, until one is seen for real (plan F6 §3.6.1).
 */
export function parseCometaOperations(bytes: Uint8Array): ParsedExport {
  const format = sniffFormat(bytes);
  if (format === "xls") throw new OperationsParseError("binary_xls");
  if (format === "xlsx") return operationsOf(tableFromXlsx(bytes));
  if (format === "xls_html") {
    const head = new TextDecoder("latin1").decode(bytes.subarray(0, 2048));
    const charset = /charset=["']?([\w-]+)/i.exec(head)?.[1]?.toLowerCase();
    const text = new TextDecoder(
      charset === "windows-1252" || charset === "iso-8859-1" ? "latin1" : "utf-8",
    ).decode(bytes);
    return operationsOf(tableFromHtml(text));
  }
  throw new OperationsParseError("no_table");
}
