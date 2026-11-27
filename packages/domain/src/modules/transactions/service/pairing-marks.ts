// modules/transactions/service/pairing-marks.ts — what a row of a giroconto carries, shared by the
// pairing (`giroconti.ts`) and the leg written on a manual account (`twins.ts`).

/** The marker of a pair a person made or confirmed: no rule ever takes it apart or moves it. */
export const PAIRED_BY_HAND = "transferGroupId";

/** A giroconto has accounts, not a category: what a row loses when it becomes one. */
export const NO_CATEGORY = {
  categoryId: null,
  categoryOrigin: null,
  categoryConfidence: null,
  categoryModelVersion: null,
  categoryReason: null,
  categoryReasonParams: null,
  categoryRuleId: null,
  suggestedCategoryId: null,
} as const;

export const withMarkers = (current: readonly string[], ...added: string[]) =>
  [...new Set([...current, ...added])].sort();
