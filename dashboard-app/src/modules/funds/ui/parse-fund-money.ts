const PLAIN_DECIMAL = /^(-?)(\d+)(?:\.(\d{1,2}))?$/;
const ITALIAN_DECIMAL = /^(-?)(\d{1,3}(?:\.\d{3})+|\d+),(\d{1,2})$/;

/** Parses a Funds form amount without crossing a floating-point boundary. */
export function parseFundMoney(raw: FormDataEntryValue | null): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  if (value === "") return null;

  const match = value.includes(",")
    ? ITALIAN_DECIMAL.exec(value)
    : PLAIN_DECIMAL.exec(value);
  if (!match) return null;

  const [, sign = "", rawInteger = "", rawFraction = ""] = match;
  const integer = rawInteger.replaceAll(".", "").replace(/^0+(?=\d)/, "");
  if (integer.length > 14) return null;

  const fraction = rawFraction.padEnd(2, "0");
  const negative = sign === "-" && (integer !== "0" || fraction !== "00");
  return `${negative ? "-" : ""}${integer}.${fraction}`;
}
