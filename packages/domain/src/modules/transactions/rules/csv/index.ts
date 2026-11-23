// The import of a CSV file of movements, its pure part (decision ST-8): records, values, the map a
// file proposes and the rows as movements.
export { csvRows, dataRecords } from "./movements";
export type { CsvMap, CsvMovement } from "./movements";
export { proposeMap } from "./proposal";
export { decodeText, detectDelimiter, isBlank, parseRecords } from "./records";
