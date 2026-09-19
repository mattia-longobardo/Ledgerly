/**
 * How deep a Wallet backfill reads (spec §9.1, F2.5). Its own module, with no dependency at all,
 * because Settings › Integrations offers the choice in the browser: `sync.ts` is server-only and
 * `mapping.ts` would bring its whole payload schema along.
 */

/** The first link fetches twelve months (spec §9.1). */
export const FIRST_LINK_MONTHS = 12;

/** The depths "Download the history again" offers. */
export const BACKFILL_CHOICES = [12, 24, 36, 60, 120] as const;

/** The deepest backfill: ten years of monthly windows. */
export const MAX_BACKFILL_MONTHS = 120;

/** The cursor key a re-download writes its depth under. */
export const BACKFILL_MONTHS = "backfillMonths";

/** The depth a transactions cursor asks for; anything unreadable is the first link's twelve. */
export function backfillDepth(cursor: Record<string, string> | null | undefined): number {
  const wanted = Number(cursor?.[BACKFILL_MONTHS]);
  return Number.isInteger(wanted) && wanted >= 1 && wanted <= MAX_BACKFILL_MONTHS
    ? wanted
    : FIRST_LINK_MONTHS;
}
