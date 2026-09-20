import type { CivilDate } from "@/platform/dates";
import type { Cents } from "@/platform/money";

/**
 * What makes one charge the same charge as another (owner, 2026-09-20).
 *
 * A PAC is paid by direct debit, and a direct debit carries its own names in the bank's text: the
 * **creditor identifier** the fund is registered under, and the **mandate reference** of the
 * signature that authorised it. Neither changes when the bank rewrites the payee, when the amount
 * is raised, or when the fund is renamed — which is exactly what a payee match cannot survive.
 *
 * No model is asked anything here. These identifiers have a shape laid down by the SEPA rulebook
 * and the app reads it, so the answer is the same every time and can be shown to the person before
 * it is used. The payee is the fallback for a bank that prints neither, which is what the rules
 * matched on before this existed.
 */

export type KeyKind = "creditor" | "mandate" | "payee";

export interface RecurrenceKey {
  kind: KeyKind;
  /** The text a rule matches on, as it is printed. */
  text: string;
}

/**
 * The SEPA creditor identifier: country, two check digits, a three-character business code and the
 * national identifier, with the spaces or dots a bank may print between the blocks.
 *
 * Taken only when the text **names** it, or when the business code is `ZZZ`. The shape alone is
 * not enough: an Italian IBAN is two letters, two digits and twenty-three more characters, so it
 * fits the same pattern — of the identifiers in the owner's own movements, forty-eight were IBANs
 * and sixteen were creditor identifiers, and only the label or the `ZZZ` told them apart
 * (measured 2026-09-20). Mistaking an account number for a creditor would match every charge that
 * ever touched that account.
 */
const SHAPE = "([A-Z]{2}[ .]?[0-9]{2}[ .]?%%[ .]?[A-Z0-9]{5,28})(?![A-Z0-9])";
const LABELLED = new RegExp(
  `(?:id(?:entificativo)?\\s*(?:del\\s+)?creditor[ei]|creditor\\s*(?:id|identifier)|\\bcid)\\b\\s*[:#]?\\s*${SHAPE.replace("%%", "[A-Z0-9]{3}")}`,
  "i",
);
const DEFAULT_BUSINESS_CODE = new RegExp(`(?<![A-Z0-9])${SHAPE.replace("%%", "ZZZ")}`, "i");

/**
 * A mandate reference, which has no shape of its own: it is read from the word in front of it.
 * Italian and English, with or without the colon the banks disagree about.
 */
const MANDATE =
  /(?:mandat[oe]|mandate\s*(?:id|ref(?:erence)?)?|rif\.?\s*mandato|id\s*mandato)\s*[:#]?\s*([A-Z0-9][A-Z0-9._/-]{4,34})/i;

/** Spaces and dots inside an identifier are decoration: banks print the same one either way. */
function compact(value: string): string {
  return value.replace(/[\s.]+/g, "").toUpperCase();
}

/**
 * The most durable name a movement carries: its creditor identifier, else its mandate reference,
 * else its payee. `null` when the movement has nothing at all to be recognised by.
 */
export function recurrenceKeyOf(movement: {
  payee: string | null;
  note: string | null;
}): RecurrenceKey | null {
  const text = `${movement.payee ?? ""} ${movement.note ?? ""}`;
  const creditor = LABELLED.exec(text) ?? DEFAULT_BUSINESS_CODE.exec(text);
  // A mandate reference can look like a creditor identifier; the creditor id wins because it names
  // who is paid, where a mandate names one signature and is replaced when the mandate is renewed.
  if (creditor) return { kind: "creditor", text: compact(creditor[1]) };
  const mandate = MANDATE.exec(text);
  if (mandate) return { kind: "mandate", text: compact(mandate[1]) };
  const payee = movement.payee?.trim() ?? "";
  return payee === "" ? null : { kind: "payee", text: payee };
}

/** Whether a movement carries the key, wherever the bank printed it. */
export function carriesKey(
  movement: { payee: string | null; note: string | null },
  key: RecurrenceKey,
): boolean {
  if (key.kind === "payee") {
    const payee = movement.payee?.toLowerCase().replace(/\s+/g, "") ?? "";
    return payee !== "" && payee.includes(key.text.toLowerCase().replace(/\s+/g, ""));
  }
  return compact(`${movement.payee ?? ""} ${movement.note ?? ""}`).includes(key.text);
}

export interface DetectedCharge {
  on: CivilDate;
  cents: Cents;
}

export interface Detection {
  key: RecurrenceKey;
  /** Every past charge that carries the key, oldest first. */
  charges: DetectedCharge[];
  first: CivilDate | null;
  last: CivilDate | null;
  /** The amount in the middle of them: one raised instalment does not move it. */
  medianCents: Cents | null;
  /** The middle gap between two charges, in days; `null` with fewer than two. */
  intervalDays: number | null;
  /** The day of the month they land on, when they agree on one. */
  dayOfMonth: number | null;
}

function median(values: readonly bigint[]): Cents | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2n;
}

function daysApart(from: CivilDate, to: CivilDate): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/**
 * What the charges carrying one key add up to: when they started, what they usually cost, how far
 * apart they fall and on which day of the month. Everything here is read off the charges — nothing
 * is projected, and a single charge answers what a single charge can (its own amount and date).
 */
export function summarise(key: RecurrenceKey, charges: readonly DetectedCharge[]): Detection {
  const ordered = [...charges].sort((a, b) => (a.on < b.on ? -1 : a.on > b.on ? 1 : 0));
  const gaps = ordered.slice(1).map((charge, index) => daysApart(ordered[index].on, charge.on));
  const days = ordered.map((charge) => Number(charge.on.slice(8, 10)));
  const agreed = days.length > 0 && days.every((day) => Math.abs(day - days[0]) <= 3);
  return {
    key,
    charges: ordered,
    first: ordered[0]?.on ?? null,
    last: ordered[ordered.length - 1]?.on ?? null,
    medianCents: median(ordered.map((charge) => charge.cents)),
    intervalDays: gaps.length === 0 ? null : Number(median(gaps.map((gap) => BigInt(gap))) ?? 0n) || null,
    dayOfMonth: agreed ? days[0] : null,
  };
}
