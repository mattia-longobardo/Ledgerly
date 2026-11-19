// The zod primitives of the domain's input schemas, declared once (audit TR-2, POC-8). The wire has
// its own in `@ledgerly/api-contract`: the domain does not import the contract (10-modularity.md §10.2).
import { z } from "zod";
import { isCivilDate } from "./dates";

/** A civil date on input, `YYYY-MM-DD` and a real day; the message is the caller's when it has one. */
export const civilDate = (message = "Not a civil date") => z.string().refine(isCivilDate, message);

/** A free text on input: trimmed, at most `max` characters, and `null` when empty or missing. */
export const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => (value === "" ? null : value))
    .nullable()
    .default(null);

/**
 * A name as it is matched: no whitespace and no case, so "Net Flix" and "netflix" are one. The one
 * definition behind a payee's key and a provider account's name (audit TRX-9).
 */
export function nameKey(name: string): string {
  return name.replace(/\s+/g, "").toLocaleLowerCase();
}

/** A colour as `#rrggbb`. */
export const HEX_COLOR = /^#[0-9a-f]{6}$/i;
