import { detectRecurring, type DetectedPattern } from "../domain/recurring";
import type { UseCaseDeps } from "./ports";

/**
 * Recomputes a user's recurring patterns from every transaction they have —
 * not a window — and replaces the stored set with exactly what the domain
 * detector finds. No principal here on purpose: this runs from inside the
 * transactions sync (`ctx.connection.userId`), which is not a request a
 * principal is attached to, so the permission check belongs to
 * `listRecurringPatterns` instead, the read side a user actually reaches.
 */
export function detectRecurringPatterns(deps: UseCaseDeps) {
  return async (userId: string): Promise<DetectedPattern[]> => {
    const all = await deps.transactions.listAll(userId);
    const candidates = all
      .filter((t) => t.type !== "transfer" && t.payee)
      .map((t) => ({ payee: t.payee!, amount: t.amount, currency: t.currency, occurredAt: t.occurredAt }));
    const patterns = detectRecurring(candidates);
    await deps.recurring.replaceAll(userId, patterns);
    return patterns;
  };
}
