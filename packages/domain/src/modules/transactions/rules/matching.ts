import type { CivilDate } from "../../../shared/dates";
import type { Cents } from "../../../shared/money";
import { payeeKeyOf } from "./records";
import type { TransactionType } from "./vocabulary";

/**
 * What a movement's texts are matched by (rewrite plan §10.11, E7): the payee's text, compared as a
 * payee key, or an identifier the bank prints in the payee or in its own text — an IBAN, an account
 * number, a creditor id — compared without spaces, dots or case.
 */
type MovementMatch = { by: "payee"; text: string } | { by: "identifier"; text: string };

/** One rule of the movement matcher (E7): an account, a text or an identifier, an amount, a window. */
export interface MovementRule {
  /** Every account when `null`. */
  accountId: string | null;
  /** The way the money goes; the amount is matched positive. */
  sign: "in" | "out";
  /** Every type when absent, giroconti included. */
  types?: readonly TransactionType[];
  /** The civil days, both included. */
  window: { from: CivilDate; to: CivilDate };
  /** Any text when absent. */
  match?: MovementMatch;
  /** Any amount when absent. */
  amountCents?: Cents;
}

/** An identifier without the spaces or dots a bank may print inside it. */
function identifierKey(value: string): string {
  return value.replace(/[\s.]+/g, "").toUpperCase();
}

/**
 * Whether a movement of the rule's account, way and window also has its text and its amount. A text
 * or an identifier that normalises to nothing matches nothing: an empty needle is not a rule.
 */
export function matchesMovement(
  rule: Pick<MovementRule, "match" | "amountCents">,
  movement: { payee: string | null; note: string | null; cents: Cents },
): boolean {
  if (rule.amountCents !== undefined && movement.cents !== rule.amountCents) return false;
  const match = rule.match;
  if (match === undefined) return true;
  if (match.by === "payee") {
    const needle = payeeKeyOf(match.text);
    return needle !== null && (payeeKeyOf(movement.payee) ?? "").includes(needle);
  }
  const needle = identifierKey(match.text);
  return needle !== "" && identifierKey(`${movement.payee ?? ""} ${movement.note ?? ""}`).includes(needle);
}
