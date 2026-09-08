import { InvalidInputError } from "./errors";

/**
 * The shape rules every mapping-rule write shares.
 *
 * `matchLabel` is the only field `classifyComponent` treats as a regular
 * expression (`new RegExp(rule.matchLabel, "i")`); `matchCode` is compared with
 * `===` against the parser's own field codes. So this compiles `matchLabel`
 * only — compiling `matchCode` too would reject perfectly valid literal codes
 * that happen to contain regex punctuation.
 *
 * The classifier already swallows a bad pattern at match time (a `SyntaxError`
 * there would take down the classification of every component on the payslip),
 * which is exactly why it has to be caught here instead: without this check a
 * broken rule is accepted, saved, and then silently never matches anything.
 */
export function assertMatchable(input: { matchCode: string | null; matchLabel: string | null }): void {
  if (input.matchCode === null && input.matchLabel === null) {
    throw new InvalidInputError("A rule needs a matchCode or a matchLabel");
  }
  if (input.matchLabel !== null) {
    try {
      new RegExp(input.matchLabel, "i");
    } catch (err) {
      throw new InvalidInputError(
        `matchLabel is not a valid regular expression: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
