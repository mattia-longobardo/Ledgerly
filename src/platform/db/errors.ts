/**
 * Whether a Postgres error with `code` (and, if given, on `constraint`) is anywhere in an error's
 * chain of causes.
 *
 * Walks the causes rather than asking `instanceof DrizzleQueryError`: the production bundle can hold
 * more than one copy of drizzle-orm, and an error thrown by one copy is not an instance of the
 * other's class. That is how, on 2026-09-18, a second Wallet group reaching an already linked local
 * group was never recognised as `link_conflict` and failed every transactions pass.
 */
export function hasPgError(error: unknown, code: string, constraint?: string): boolean {
  for (let cause: unknown = error; typeof cause === "object" && cause !== null;) {
    const { code: found, constraint: violated } = cause as { code?: unknown; constraint?: unknown };
    if (found === code && (constraint === undefined || violated === constraint)) return true;
    cause = (cause as { cause?: unknown }).cause;
  }
  return false;
}

/** A unique key refused a write (23505). */
export const UNIQUE_VIOLATION = "23505";
/** A row is still referenced by a foreign key that does not cascade (23503). */
export const FOREIGN_KEY_VIOLATION = "23503";
