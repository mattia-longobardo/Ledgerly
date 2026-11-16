/**
 * The IBAN of an account (rewrite plan N4, decisions H39 and H45-H47): one form to compare and to
 * store, one check, and the grouped form a page shows. Shared by the accounts, the transactions
 * and the plugin runtime: no copy of the check lives anywhere else.
 *
 * An IBAN is a person's own data. Nothing here logs, and no caller sends one to a log, a URL, a
 * toast, the API, MCP or an export (H45).
 */

/** Spaces and dashes out, upper case: the form an IBAN is compared in. */
function compact(text: string): string {
  return text.replace(/[\s-]/g, "").toUpperCase();
}

/**
 * A text as an IBAN, or `null` when it is not one: the shape and the ISO 13616 mod-97 check both
 * have to hold, so a free-text reference or another kind of account number never passes.
 */
export function normalizeIban(text: string | null | undefined): string | null {
  if (text === null || text === undefined) return null;
  const iban = compact(text);
  if (!/^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$/.test(iban)) return null;
  const digits = (iban.slice(4) + iban.slice(0, 4)).replace(/[A-Z]/g, (letter) =>
    String(letter.charCodeAt(0) - 55),
  );
  let remainder = 0;
  for (const digit of digits) remainder = (remainder * 10 + Number(digit)) % 97;
  return remainder === 1 ? iban : null;
}

/** An IBAN in groups of four, as a page shows it in full ("IT60 X054 2811 …"). */
export function groupIban(iban: string): string {
  return iban.replace(/(.{4})(?=.)/g, "$1 ");
}
