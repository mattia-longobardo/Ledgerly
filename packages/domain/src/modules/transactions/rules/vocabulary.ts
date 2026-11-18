export const TRANSACTION_TYPES = ["income", "expense", "transfer"] as const;
export const TRANSACTION_STATES = ["cleared", "pending"] as const;
export const CATEGORY_TYPES = ["income", "expense", "transfer"] as const;
/**
 * Who wrote a movement (rewrite plan, 04-now.md §4.5): a provider's reading, or the person, by
 * hand. A reading never changes, removes or declares gone a `manual` movement.
 */
export const TRANSACTION_ORIGINS = ["provider", "manual"] as const;

/**
 * Where a manual movement of a "read and write" account stands with its source (rewrite plan N3.1,
 * 12-account-modes.md §12.2): waiting for the next update, or refused by the last one. `null` on
 * every other movement: one that was sent is the source's own from then on.
 */
export const SEND_STATES = ["to_send", "not_sent"] as const;
export type SendState = (typeof SEND_STATES)[number];

export type TransactionType = (typeof TRANSACTION_TYPES)[number];
export type TransactionState = (typeof TRANSACTION_STATES)[number];
export type TransactionOrigin = (typeof TRANSACTION_ORIGINS)[number];

/**
 * Who chose the category of a movement (rewrite plan, 04-now.md §4.4). `user` and `provider` are
 * confirmed labels: a person or a source gave them, and the classifier learns from them. `memory`,
 * `model` and `table` are the levels of the cascade that gave it by itself: an automatic category,
 * which counts like any other and is never learnt from. `rule` is a rule of the person's
 * (categories-and-rules.md §4, CR6): automatic too, and never learnt from either. `null` on a row
 * with no category, and on a row written by an image that knew no origin — there the category is a
 * confirmed one.
 */
export const CATEGORY_ORIGINS = ["user", "provider", "memory", "model", "table", "rule"] as const;
type CategoryOrigin = (typeof CATEGORY_ORIGINS)[number];
/** The origins of an automatic category. */
export const AUTOMATIC_CATEGORY_ORIGINS: readonly CategoryOrigin[] = ["memory", "model", "table", "rule"];

export type CategoryState = "chosen" | "automatic" | "suggestion" | "none";

/**
 * The state of a movement's category, from the columns that hold it (ux/n3-categories-manual.md
 * §1.2): `chosen` by a person or a source, `automatic`, a `suggestion` that does not count yet, or
 * `none`.
 */
export function categoryStateOf(row: {
  categoryId: string | null;
  categoryOrigin: string | null;
  suggestedCategoryId: string | null;
}): CategoryState {
  if (row.categoryId !== null) {
    return row.categoryOrigin !== null &&
      AUTOMATIC_CATEGORY_ORIGINS.includes(row.categoryOrigin as CategoryOrigin)
      ? "automatic"
      : "chosen";
  }
  return row.suggestedCategoryId === null ? "none" : "suggestion";
}

export type CategoryType = (typeof CATEGORY_TYPES)[number];

/**
 * The longest a category or label name may be — the bound `categories_name_ck` and
 * `labels_name_ck` enforce in `schema.ts`. Lives here, not in `taxonomy.ts`, because the client
 * forms need it too and `taxonomy.ts` is `server-only`.
 */
export const NAME_MAX = 60;

/** The fields a user can own locally; everything else belongs to the provider (spec §7.2). */

export type EditableField = "categoryId" | "note" | "labels";

/** Recurrence interval bands, in days (spec §7.2). */
export const RECURRENCE_BANDS = [
  { cadence: "weekly", min: 5, max: 9 },
  { cadence: "biweekly", min: 12, max: 16 },
  { cadence: "monthly", min: 26, max: 34 },
  { cadence: "quarterly", min: 80, max: 100 },
  { cadence: "yearly", min: 350, max: 380 },
] as const;

export type Cadence = (typeof RECURRENCE_BANDS)[number]["cadence"];

/** At least this many occurrences before a payee counts as recurring (spec §7.2). */
export const RECURRENCE_MIN_OCCURRENCES = 3;

/** How far each amount may sit from the median and still belong to the pattern (spec §7.2). */
export const RECURRENCE_AMOUNT_TOLERANCE = 0.1;

/**
 * The fields a provider owns: the sync writes them, the interface never offers them (spec §7.2).
 * Everything a person may change is in `EDITABLE_FIELDS`; visibility is user-owned too but has no
 * marker, because the sync never writes `hidden_at` at all.
 */
export const PROVIDER_OWNED_FIELDS = [
  "accountId",
  "occurredAt",
  "amountCents",
  "currency",
  "type",
  "state",
  "payee",
] as const;

type ProviderOwnedField = (typeof PROVIDER_OWNED_FIELDS)[number];

/** A field name as it appears in `locally_edited`. */
export type MergeableField = ProviderOwnedField | EditableField;

export const DAY_MS = 86_400_000;
