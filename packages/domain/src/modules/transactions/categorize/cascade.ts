/**
 * The cascade of the automatic categories (rewrite plan, 04-now.md §4.4): structure → strict
 * memory → the person's classifier → the static tables → nothing. One pure function from a
 * movement and what is known about the person to a decision; the service only reads and writes.
 */
import { type Model, predict } from "./classifier";
import { type GroupKey, brandGroup, merchantTypeGroup, STRUCTURE_GROUP, structureOf } from "./tables";
import { type MovementText, memoryKey, shownText } from "./text";
import type { Thresholds } from "./thresholds";

/** Why a category was given or suggested: a closed list, a fixed sentence for each (ux §2.2). */
export const REASONS = ["memory", "similar", "merchant_type", "brand", "salary", "fee"] as const;
export type Reason = (typeof REASONS)[number];

/** Which level of the cascade gave an automatic category. */
export const AUTOMATIC_ORIGINS = ["memory", "model", "table"] as const;
export type AutomaticOrigin = (typeof AUTOMATIC_ORIGINS)[number];

/** A movement as the cascade reads it. */
export interface CascadeMovement extends MovementText {
  kind: "income" | "expense";
  merchantCategoryCode: string | null;
  bankTransactionCode: string | null;
}

/** What is known about one person when the cascade runs. */
export interface Knowledge {
  /** Key of a text → category, from `strictMemory`. */
  memory: ReadonlyMap<string, string>;
  model: Model | null;
  thresholds: Thresholds;
  /** The person's category for a default group, where they have one. */
  groupCategory: ReadonlyMap<GroupKey, string>;
  /** The categories a movement may be given, with their kind: an archived one is not here. */
  categoryKind: ReadonlyMap<string, "income" | "expense" | "transfer">;
}

export type Decision =
  | {
      kind: "automatic";
      categoryId: string;
      origin: AutomaticOrigin;
      reason: Reason;
      params: Record<string, string>;
      /** The classifier's confidence, for the row only: it never reaches a browser. */
      confidence: number | null;
    }
  | { kind: "suggestion"; categoryId: string; reason: Reason; params: Record<string, string> }
  | { kind: "none" };

const NONE: Decision = { kind: "none" };

/**
 * The category of a movement, or none. A level answers only with a category the person still has
 * and of the movement's own kind — an income is never filed under a spending category — and a
 * level that cannot answer hands over to the next.
 */
export function decide(movement: CascadeMovement, knowledge: Knowledge): Decision {
  const fits = (categoryId: string | undefined): categoryId is string =>
    categoryId !== undefined && knowledge.categoryKind.get(categoryId) === movement.kind;

  // 0 · Structure: what the bank itself says the movement is.
  const structure = structureOf(movement.bankTransactionCode);
  if (structure !== null) {
    const categoryId = knowledge.groupCategory.get(STRUCTURE_GROUP[structure]);
    if (fits(categoryId)) {
      return {
        kind: "automatic",
        categoryId,
        origin: "table",
        reason: structure,
        params: {},
        confidence: null,
      };
    }
  }

  // 1 · Memory: the last three times, the same category.
  const remembered = knowledge.memory.get(memoryKey(movement));
  if (fits(remembered)) {
    return {
      kind: "automatic",
      categoryId: remembered,
      origin: "memory",
      reason: "memory",
      params: { text: shownText(movement) },
      confidence: null,
    };
  }

  // 2 · The person's classifier: automatic above the high threshold, a suggestion between the two.
  let suggestion: Decision = NONE;
  if (knowledge.model !== null) {
    const prediction = predict(knowledge.model, movement);
    const { automatic, suggestion: low } = knowledge.thresholds;
    if (fits(prediction.categoryId)) {
      if (automatic !== null && prediction.confidence >= automatic) {
        return {
          kind: "automatic",
          categoryId: prediction.categoryId,
          origin: "model",
          reason: "similar",
          params: {},
          confidence: prediction.confidence,
        };
      }
      if (low !== null && prediction.confidence >= low) {
        suggestion = { kind: "suggestion", categoryId: prediction.categoryId, reason: "similar", params: {} };
      }
    }
  }

  // 3 · The tables: the merchant type the bank gives, then a brand the text names.
  const merchantType = merchantTypeGroup(movement.merchantCategoryCode);
  const brand = brandGroup(
    [movement.payee, movement.counterparty, movement.rawText].filter(Boolean).join(" "),
  );
  const answers: ({
    group: GroupKey;
    ambiguous: boolean;
    reason: Reason;
    params: Record<string, string>;
  } | null)[] = [
    merchantType && { ...merchantType, reason: "merchant_type", params: {} },
    brand && {
      group: brand.group,
      ambiguous: brand.ambiguous,
      reason: "brand",
      params: { brand: brand.brand },
    },
  ];
  for (const answer of answers) {
    if (!answer) continue;
    const categoryId = knowledge.groupCategory.get(answer.group);
    if (!fits(categoryId)) continue;
    if (!answer.ambiguous) {
      return {
        kind: "automatic",
        categoryId,
        origin: "table",
        reason: answer.reason,
        params: answer.params,
        confidence: null,
      };
    }
    if (suggestion.kind === "none") {
      suggestion = { kind: "suggestion", categoryId, reason: answer.reason, params: answer.params };
    }
  }

  return suggestion;
}

/**
 * A person's category for each default group: the one created from the group (`marked`), else an
 * active category with the group's own name in either language. Without one, a table that points
 * at the group gives nothing for this person.
 */
export function groupCategories(
  groups: readonly { key: GroupKey; type: string; en: string; it: string }[],
  categories: readonly { id: string; name: string; type: string }[],
  marked: ReadonlyMap<string, GroupKey>,
): Map<GroupKey, string> {
  const found = new Map<GroupKey, string>();
  for (const category of categories) {
    const key = marked.get(category.id);
    if (key !== undefined && !found.has(key)) found.set(key, category.id);
  }
  const plain = (text: string) => text.trim().toLowerCase();
  for (const group of groups) {
    if (found.has(group.key)) continue;
    const match = categories.find(
      (category) =>
        category.type === group.type &&
        (plain(category.name) === plain(group.en) || plain(category.name) === plain(group.it)),
    );
    if (match) found.set(group.key, match.id);
  }
  return found;
}
