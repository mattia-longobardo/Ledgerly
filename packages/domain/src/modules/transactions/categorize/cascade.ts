/**
 * The cascade of the automatic categories (rewrite plan, 04-now.md §4.4): structure → strict
 * memory → the person's classifier → the static tables → nothing. One pure function from a
 * movement and what is known about the person to a decision; the service only reads and writes.
 *
 * R6 (H56): where the worker has the embedding model, the classifier is the one trained with the
 * embeddings as features, and a text the classifier cannot place may still get a suggestion from
 * the category it reads closest to (the cold start). Elsewhere the cascade is the one of before.
 */
import { type Model, predict, predictGroup, ranked } from "./classifier";
import { cosine, type Embedder } from "../rules/embedding";
import { type GroupKey, brandGroup, merchantTypeGroup, STRUCTURE_GROUP, structureOf } from "./tables";
import { memoryKey, merchantKey, type MovementText, shownText, wordsOf } from "./text";
import type { Thresholds } from "./thresholds";

/** Why a category was given or suggested: a closed list, a fixed sentence for each (ux §2.2). */
type Reason = "memory" | "similar" | "group" | "merchant_type" | "brand" | "salary" | "fee";

/** Which level of the cascade gave an automatic category. */
type AutomaticOrigin = "memory" | "model" | "table";

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
  categoryKind: ReadonlyMap<string, "income" | "expense">;
  /** R6: the embedding level, in the worker only; `null` everywhere else and when it is off. */
  embedded?: EmbeddedKnowledge | null;
  /** PERS-634: the group of each category — its parent, or itself for a group. */
  categoryGroup?: ReadonlyMap<string, string>;
  /** PERS-634: the least confidence at which a group is suggested; `null` or absent: none is. */
  groupThreshold?: number | null;
}

/** A category as the embedding model reads it: its name and, for a default group, the group's words. */
export interface Prototype {
  categoryId: string;
  vector: Float32Array;
}

export interface EmbeddedKnowledge {
  embedder: Embedder;
  /** The classifier trained with the embeddings, and its thresholds; `null` before the first. */
  model: Model | null;
  thresholds: Thresholds;
  prototypes: readonly Prototype[];
  /** The least closeness at which the cold start suggests; `null`: it suggests nothing. */
  coldStart: number | null;
}

/**
 * The category whose words read closest to a text, among those `fits` allows, and how close: the
 * cosine moved to 0..1, so it is read like a confidence. `null` with no category to choose from.
 */
export function closestCategory(
  prototypes: readonly Prototype[],
  vector: Float32Array,
  fits: (categoryId: string) => boolean,
): { categoryId: string; confidence: number } | null {
  let best: { categoryId: string; confidence: number } | null = null;
  for (const prototype of prototypes) {
    if (!fits(prototype.categoryId)) continue;
    const confidence = (1 + cosine(prototype.vector, vector)) / 2;
    if (best === null || confidence > best.confidence)
      best = { categoryId: prototype.categoryId, confidence };
  }
  return best;
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

/** The classifier the cascade asks: the one with the embeddings where there is one, else today's. */
function classifierOf(knowledge: Knowledge) {
  const embedded = knowledge.embedded;
  return embedded?.model != null
    ? { model: embedded.model, thresholds: embedded.thresholds, embedder: embedded.embedder }
    : { model: knowledge.model, thresholds: knowledge.thresholds, embedder: null };
}

/** The cold start's suggestion: the closest category, when it is at least as close as its threshold. */
function coldStart(
  movement: CascadeMovement,
  embedded: EmbeddedKnowledge | null,
  fits: (categoryId: string | undefined) => categoryId is string,
): Decision {
  const words = wordsOf(movement);
  if (embedded === null || embedded.coldStart === null || words === "") return NONE;
  const closest = closestCategory(embedded.prototypes, embedded.embedder.embed(words), fits);
  return closest !== null && closest.confidence >= embedded.coldStart
    ? { kind: "suggestion", categoryId: closest.categoryId, reason: "similar", params: {} }
    : NONE;
}

/**
 * The category of a movement, or none. A level answers only with a category the person still has
 * and of the movement's own kind — an income is never filed under a spending category — and a
 * level that cannot answer hands over to the next.
 */
/** Whether a category is one the person still has, of the movement's own kind. */
function fitsOf(knowledge: Knowledge, movement: CascadeMovement) {
  return (categoryId: string | undefined): categoryId is string =>
    categoryId !== undefined && knowledge.categoryKind.get(categoryId) === movement.kind;
}

/**
 * The group, when no sub-category could be given or suggested (PERS-634, decision 14A): today's
 * classifier, its categories' probabilities summed by group, at the group's own threshold.
 */
function groupSuggestion(
  movement: CascadeMovement,
  knowledge: Knowledge,
  fits: (categoryId: string | undefined) => categoryId is string,
): Decision {
  const { model, categoryGroup, groupThreshold } = knowledge;
  if (model === null || categoryGroup === undefined || groupThreshold == null) return NONE;
  const group = predictGroup(model, movement, (categoryId) => categoryGroup.get(categoryId));
  return group !== null && group.confidence >= groupThreshold && fits(group.categoryId)
    ? { kind: "suggestion", categoryId: group.categoryId, reason: "group", params: {} }
    : NONE;
}

export function decide(movement: CascadeMovement, knowledge: Knowledge): Decision {
  const fits = fitsOf(knowledge, movement);

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

  // 1 · Memory: the last three times at this merchant, the same category. A memory stored before
  // PERS-634 is keyed by the whole text: it answers until the next training rewrites it.
  const remembered = knowledge.memory.get(merchantKey(movement)) ?? knowledge.memory.get(memoryKey(movement));
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
  const classifier = classifierOf(knowledge);
  if (classifier.model !== null) {
    const prediction = predict(classifier.model, movement, classifier.embedder);
    const { automatic, suggestion: low } = classifier.thresholds;
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

  // 2b · The cold start (R6): the category a text never seen reads closest to. A suggestion only.
  if (suggestion.kind === "none") suggestion = coldStart(movement, knowledge.embedded ?? null, fits);

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

  // 4 · The group, when no sub-category is likely enough (PERS-634).
  return suggestion.kind === "none" ? groupSuggestion(movement, knowledge, fits) : suggestion;
}

/**
 * The categories the selector shows first (PERS-634, decision 14A): the cascade's own answer, then
 * the classifier's likeliest, of the movement's kind, `count` at most. A suggested group is not
 * among them: they are what to choose inside it.
 */
export function topCategories(movement: CascadeMovement, knowledge: Knowledge, count = 3): string[] {
  const fits = fitsOf(knowledge, movement);
  const decision = decide(movement, knowledge);
  const first = decision.kind === "none" || decision.reason === "group" ? [] : [decision.categoryId];
  const classifier = classifierOf(knowledge);
  const likeliest = classifier.model === null ? [] : ranked(classifier.model, movement, classifier.embedder);
  return [...new Set([...first, ...likeliest])].filter((categoryId) => fits(categoryId)).slice(0, count);
}

/**
 * A person's category for each key of the default tree: the one created from it (`marked`), else an
 * active category with its name in either language, of its sign, and — for a sub-category — under
 * the person's category of its group: "Mantenimento figli" of Income is not the one of Financial
 * expenses. Without one, a table that points at the key gives nothing for this person.
 */
export function groupCategories(
  defaults: readonly { key: GroupKey; parent: GroupKey | null; type: string; en: string; it: string }[],
  categories: readonly { id: string; name: string; type: string; parentId: string | null }[],
  marked: ReadonlyMap<string, GroupKey>,
): Map<GroupKey, string> {
  const found = new Map<GroupKey, string>();
  for (const category of categories) {
    const key = marked.get(category.id);
    if (key !== undefined && !found.has(key)) found.set(key, category.id);
  }
  const plain = (text: string) => text.trim().toLowerCase();
  // Groups come before their sub-categories in `defaults`, so a group is found before its children.
  for (const one of defaults) {
    if (found.has(one.key)) continue;
    const parentId = one.parent === null ? null : found.get(one.parent);
    if (parentId === undefined) continue;
    const match = categories.find(
      (category) =>
        category.type === one.type &&
        category.parentId === parentId &&
        (plain(category.name) === plain(one.en) || plain(category.name) === plain(one.it)),
    );
    if (match) found.set(one.key, match.id);
  }
  return found;
}
